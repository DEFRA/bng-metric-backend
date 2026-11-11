import { describe, expect, it } from 'vitest'

import {
  fullReadBuffer,
  mutateSerializedBuffer,
  withTempGpkgFile
} from '../../../test/helpers/gpkg.js'
import {
  checkHabitatComments,
  cleanComment,
  commentForBaseline,
  commentForPostIntervention,
  commentLength,
  MAX_COMMENT_LENGTH
} from './comment-check.js'
import { ERROR_CODES } from './errors.js'
import { readGeoPackage } from './geopackage.js'
import { runDataQualityChecks } from './index.js'

// Length is the format gate's to check (text-values-gate.js), so a long
// comment passes here.
const LONG_COMMENT = 'a'.repeat(5000)

function feature(comment, extra = {}, column = 'Comment') {
  return { properties: { [column]: comment, ...extra } }
}

function codesOf(errors) {
  return errors.map((error) => error.code)
}

describe('commentLength', () => {
  it('counts code points after trimming, so an emoji is one character', () => {
    expect(commentLength(`  ${'🌳'.repeat(MAX_COMMENT_LENGTH)}  `)).toBe(
      MAX_COMMENT_LENGTH
    )
    expect(commentLength('a'.repeat(MAX_COMMENT_LENGTH))).toBe(
      MAX_COMMENT_LENGTH
    )
  })

  it('counts a CRLF line break as the one character it is stored as', () => {
    const withBreak = `${'a'.repeat(MAX_COMMENT_LENGTH - 2)}\r\na`
    expect(commentLength(withBreak)).toBe(MAX_COMMENT_LENGTH)
    expect(cleanComment(withBreak)).toHaveLength(MAX_COMMENT_LENGTH)
  })
})

describe('cleanComment', () => {
  it('trims the ends and keeps spaces inside the text', () => {
    expect(cleanComment('  kept  note \n')).toBe('kept  note')
  })

  // A browser newline-normalises a textarea's value to CRLF when it submits
  // the form, so the feature edit route would otherwise store the same text
  // an upload stores with LF line breaks.
  it('stores a CRLF or CR line break as LF', () => {
    expect(cleanComment(' one\r\ntwo\rthree\nfour ')).toBe(
      'one\ntwo\nthree\nfour'
    )
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
  it('leaves the length of a comment to the format gate', () => {
    const layers = {
      areas: [feature(`  ${LONG_COMMENT}  `)],
      hedgerows: [feature(LONG_COMMENT, {}, 'Comments')]
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
      areas: [feature('H�01', { 'Parcel Ref': 'H1', fid: 1 })]
    })
    expect(codesOf(errors)).toContain(ERROR_CODES.COMMENT_INVALID_CHARACTERS)
  })
})
