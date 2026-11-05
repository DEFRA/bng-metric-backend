import { describe, expect, it } from 'vitest'

import {
  fullReadBuffer,
  mutateSerializedBuffer,
  withTempGpkgFile
} from '../../../test/helpers/gpkg.js'
import {
  MAX_COMMENT_LENGTH,
  checkHabitatComments,
  cleanComment,
  commentForBaseline,
  commentForPostIntervention
} from './comment-check.js'
import { ERROR_CODES } from './errors.js'
import { readGeoPackage } from './geopackage.js'
import { runDataQualityChecks } from './index.js'

const EXACT_LIMIT = 'a'.repeat(MAX_COMMENT_LENGTH)
const OVER_LIMIT = 'a'.repeat(MAX_COMMENT_LENGTH + 1)

function feature(comment, extra = {}, column = 'Comment') {
  return { properties: { [column]: comment, ...extra } }
}

function codesOf(errors) {
  return errors.map((error) => error.code)
}

describe('cleanComment', () => {
  it('trims the ends and keeps spaces inside the text', () => {
    expect(cleanComment('  kept  note \n')).toBe('kept  note')
  })

  it('turns a blank comment into null', () => {
    expect(cleanComment(' \t\n ')).toBeNull()
    expect(cleanComment('')).toBeNull()
    expect(cleanComment(null)).toBeNull()
    expect(cleanComment(undefined)).toBeNull()
  })

  it('turns a number into its text and ignores other values', () => {
    expect(cleanComment(12)).toBe('12')
    expect(cleanComment(Buffer.from([0xff]))).toBeNull()
  })
})

describe('comment placement', () => {
  it('keeps a Retained, Lost or uncategorised comment on the baseline habitat', () => {
    const retained = {
      'Retention Category': 'Retained',
      Comment: '  note  '
    }
    const lost = { 'Retention Category': '4. Lost', Comment: 'lost' }
    const plain = { Comment: 'baseline' }

    expect(commentForBaseline(retained)).toBe('note')
    expect(commentForPostIntervention(retained)).toBeNull()
    expect(commentForBaseline(lost)).toBe('lost')
    expect(commentForPostIntervention(lost)).toBeNull()
    expect(commentForBaseline(plain)).toBe('baseline')
    expect(commentForPostIntervention(plain)).toBeNull()
  })

  it('keeps an Enhanced or Created comment on the post-intervention habitat of a legacy combined upload', () => {
    const enhanced = {
      'Retention Category': '1. Enhanced',
      Comment: ' enhanced '
    }
    const created = { 'Retention Category': 'Created', Comment: 'created' }
    const combined = { sharesRowWithPostIntervention: true }

    expect(commentForBaseline(enhanced, combined)).toBeNull()
    expect(commentForPostIntervention(enhanced)).toBe('enhanced')
    expect(commentForBaseline(created, combined)).toBeNull()
    expect(commentForPostIntervention(created)).toBe('created')
  })

  it('keeps an Enhanced comment on a baseline-only upload', () => {
    const enhanced = {
      'Retention Category': 'Enhanced',
      Comment: ' enhanced note '
    }

    expect(commentForBaseline(enhanced)).toBe('enhanced note')
  })

  it('keeps every retention category on a BNG Service template post-intervention row', () => {
    const template = { template: true }
    const retained = { 'Retention Category': 'Retained', Comment: ' retained ' }
    const lost = { 'Retention Category': 'Lost', Comment: 'lost note' }

    expect(commentForPostIntervention(retained, template)).toBe('retained')
    expect(commentForPostIntervention(lost, template)).toBe('lost note')
    expect(commentForBaseline(retained)).toBe('retained')
  })
})

describe('checkHabitatComments', () => {
  it('accepts a comment of exactly 999 characters, including one padded with whitespace', () => {
    const layers = {
      areas: [feature(`  ${EXACT_LIMIT}  `)],
      trees: [feature(EXACT_LIMIT)],
      hedgerows: [feature(EXACT_LIMIT, {}, 'Comments')]
    }
    expect(checkHabitatComments(layers)).toEqual([])
  })

  it('accepts valid non-ASCII text, and a missing comment column', () => {
    const layers = {
      areas: [feature('Côte-ŷ 草地')],
      watercourses: [{ properties: { 'Parcel Ref': 'R1' } }]
    }
    expect(checkHabitatComments(layers)).toEqual([])
    expect(checkHabitatComments(null)).toEqual([])
  })

  it('ignores a null, empty or whitespace-only comment', () => {
    const layers = {
      areas: [feature(null), feature(''), feature(' \n\t ')],
      hedgerows: [feature('   ', {}, 'Comments')]
    }
    expect(checkHabitatComments(layers)).toEqual([])
  })

  it('rejects a comment of 1000 characters once it has been trimmed', () => {
    const layers = {
      areas: [feature(`\n${OVER_LIMIT} `), feature(EXACT_LIMIT, { fid: 2 })]
    }
    const [error] = checkHabitatComments(layers)
    expect(error.code).toBe(ERROR_CODES.COMMENT_TOO_LONG)
    expect(error.details).toEqual({
      count: 1,
      sample: [{ layer: 'areas', idx: 0 }]
    })
  })

  it('counts characters, so an emoji counts as one', () => {
    expect(
      checkHabitatComments({
        areas: [feature('🌳'.repeat(MAX_COMMENT_LENGTH))]
      })
    ).toEqual([])
    expect(
      codesOf(
        checkHabitatComments({
          areas: [feature('🌳'.repeat(MAX_COMMENT_LENGTH + 1))]
        })
      )
    ).toEqual([ERROR_CODES.COMMENT_TOO_LONG])
  })

  it('collates comments that are not valid UTF-8, on every layer', () => {
    const layers = {
      areas: [feature('H�01', { fid: 1 })],
      hedgerows: [feature(Buffer.from([0xff]), { fid: 3 }, 'Comments')],
      trees: [feature('fine', { fid: 4 })]
    }
    const [error] = checkHabitatComments(layers)
    expect(error.code).toBe(ERROR_CODES.COMMENT_INVALID_CHARACTERS)
    expect(error.details.sample).toEqual([
      { layer: 'areas', idx: 0, fid: 1 },
      { layer: 'hedgerows', idx: 0, fid: 3 }
    ])
  })

  it('reports a comment that is both too long and not UTF-8 under both codes', () => {
    const layers = { areas: [feature(`${'�'}${OVER_LIMIT}`, { fid: 9 })] }
    expect(codesOf(checkHabitatComments(layers))).toEqual([
      ERROR_CODES.COMMENT_INVALID_CHARACTERS,
      ERROR_CODES.COMMENT_TOO_LONG
    ])
  })

  it('catches bytes that are not UTF-8 in a real GeoPackage, as the upload reads it', async () => {
    const buffer = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.exec(`UPDATE "Habitats" SET "Comment" = CAST(X'48FF3031' AS TEXT)`)
    })
    await withTempGpkgFile(buffer, (filePath) => {
      const layers = readGeoPackage(filePath)
      expect(codesOf(checkHabitatComments(layers))).toEqual([
        ERROR_CODES.COMMENT_INVALID_CHARACTERS
      ])
    })
  })

  it('is one of the data-quality checks, so it refuses the file', () => {
    const errors = runDataQualityChecks({
      areas: [feature(OVER_LIMIT, { 'Parcel Ref': 'H1', fid: 1 })]
    })
    expect(codesOf(errors)).toContain(ERROR_CODES.COMMENT_TOO_LONG)
  })
})
