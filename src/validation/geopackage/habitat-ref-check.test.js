import { describe, expect, it } from 'vitest'

import {
  fullReadBuffer,
  mutateSerializedBuffer,
  withTempGpkgFile
} from '../../../test/helpers/gpkg.js'
import { ERROR_CODES } from './errors.js'
import { readGeoPackage } from './geopackage.js'
import {
  MAX_HABITAT_REF_LENGTH,
  checkHabitatRefs,
  cleanHabitatRef
} from './habitat-ref-check.js'

function feature(parcelRef, extra = {}) {
  return { properties: { 'Parcel Ref': parcelRef, ...extra } }
}

function codesOf(errors) {
  return errors.map((e) => e.code)
}

describe('checkHabitatRefs — valid references', () => {
  it('passes when every habitat on every layer has a reference', () => {
    const layers = {
      areas: [feature('H001'), feature('H002')],
      hedgerows: [feature('HG001')],
      watercourses: [feature('R001')]
    }
    expect(checkHabitatRefs(layers)).toEqual([])
  })

  it('passes when habitats share a reference (AC4)', () => {
    const layers = { areas: [feature('H001'), feature('H001')] }
    expect(checkHabitatRefs(layers)).toEqual([])
  })

  it('passes a reference longer than the maximum, which is truncated on save (AC5)', () => {
    const layers = {
      areas: [feature('H'.repeat(MAX_HABITAT_REF_LENGTH + 20))]
    }
    expect(checkHabitatRefs(layers)).toEqual([])
  })

  it('passes non-ASCII text that is valid UTF-8', () => {
    const layers = { areas: [feature('Côte-ŷ 草地 🌳')] }
    expect(checkHabitatRefs(layers)).toEqual([])
  })

  it('passes a numeric reference', () => {
    expect(checkHabitatRefs({ areas: [feature(12)] })).toEqual([])
  })

  it('passes when the layers are missing or empty', () => {
    expect(checkHabitatRefs({})).toEqual([])
    expect(checkHabitatRefs({ areas: [] })).toEqual([])
    expect(checkHabitatRefs(null)).toEqual([])
  })

  it('does not check tree references', () => {
    const layers = { trees: [{ properties: { 'Tree Ref': null } }] }
    expect(checkHabitatRefs(layers)).toEqual([])
  })
})

describe('checkHabitatRefs — missing references (AC1)', () => {
  it('collates every missing or blank reference, on every layer, into one error', () => {
    const layers = {
      areas: [
        feature(null, { fid: 1 }),
        feature('', { fid: 2 }),
        feature('   ', { fid: 3 }),
        feature('H004', { fid: 4 })
      ],
      hedgerows: [{ properties: { fid: 7 } }],
      watercourses: [feature('\t')]
    }
    const errors = checkHabitatRefs(layers)
    expect(errors).toHaveLength(1)
    const [err] = errors
    expect(err.code).toBe(ERROR_CODES.HABITAT_REF_MISSING)
    expect(err.details.count).toBe(5)
    expect(err.details.sample).toEqual([
      { layer: 'areas', idx: 0, fid: 1 },
      { layer: 'areas', idx: 1, fid: 2 },
      { layer: 'areas', idx: 2, fid: 3 },
      { layer: 'hedgerows', idx: 0, fid: 7 },
      { layer: 'watercourses', idx: 0 }
    ])
    expect(err.message).toBe(
      'Every habitat must have a Parcel Ref: areas fid 1, areas fid 2, areas fid 3, hedgerows fid 7, watercourses feature #0'
    )
  })

  it('caps the sample and says how many more there are', () => {
    const areas = Array.from({ length: 53 }, () => feature(null))
    const [err] = checkHabitatRefs({ areas })
    expect(err.details.count).toBe(53)
    expect(err.details.sample).toHaveLength(50)
    expect(err.message).toMatch(/\(and 3 more\)$/)
  })
})

describe('checkHabitatRefs — invalid characters (AC2)', () => {
  it('collates every reference with characters that are not valid UTF-8 into one error', () => {
    const layers = {
      areas: [feature('H�01', { fid: 1 }), feature('H002', { fid: 2 })],
      hedgerows: [feature(Buffer.from([0xff, 0xfe]), { fid: 3 })]
    }
    const errors = checkHabitatRefs(layers)
    expect(codesOf(errors)).toEqual([
      ERROR_CODES.HABITAT_REF_INVALID_CHARACTERS
    ])
    expect(errors[0].details).toEqual({
      count: 2,
      sample: [
        { layer: 'areas', idx: 0, fid: 1 },
        { layer: 'hedgerows', idx: 0, fid: 3 }
      ]
    })
  })

  it('catches bytes that are not UTF-8 in a real GeoPackage, as the upload reads it', async () => {
    // "H", an invalid byte, then "01", stored as TEXT.
    const buffer = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.exec(`UPDATE "Habitats" SET "Parcel Ref" = CAST(X'48FF3031' AS TEXT)`)
      db.exec(`UPDATE "Hedgerows" SET "Parcel Ref" = 'HG001'`)
      db.exec(`UPDATE "Rivers" SET "Parcel Ref" = 'R001'`)
    })
    await withTempGpkgFile(buffer, (filePath) => {
      const layers = readGeoPackage(filePath)
      expect(codesOf(checkHabitatRefs(layers))).toEqual([
        ERROR_CODES.HABITAT_REF_INVALID_CHARACTERS
      ])
    })
  })

  it('reports missing and invalid references as two errors', () => {
    const layers = { areas: [feature(null), feature('H�')] }
    expect(codesOf(checkHabitatRefs(layers))).toEqual([
      ERROR_CODES.HABITAT_REF_MISSING,
      ERROR_CODES.HABITAT_REF_INVALID_CHARACTERS
    ])
  })
})

describe('cleanHabitatRef', () => {
  it('trims leading and trailing whitespace (AC3)', () => {
    expect(cleanHabitatRef('  H001 \t')).toBe('H001')
  })

  it(`truncates to ${MAX_HABITAT_REF_LENGTH} characters (AC5)`, () => {
    const ref = cleanHabitatRef(` ${'A'.repeat(MAX_HABITAT_REF_LENGTH + 5)} `)
    expect(ref).toBe('A'.repeat(MAX_HABITAT_REF_LENGTH))
  })

  it('keeps a reference of exactly the maximum length', () => {
    const ref = 'B'.repeat(MAX_HABITAT_REF_LENGTH)
    expect(cleanHabitatRef(ref)).toBe(ref)
  })

  it('counts characters, so a cut never splits one in two', () => {
    const ref = cleanHabitatRef('🌳'.repeat(MAX_HABITAT_REF_LENGTH + 1))
    expect(Array.from(ref)).toHaveLength(MAX_HABITAT_REF_LENGTH)
    expect(ref).toBe('🌳'.repeat(MAX_HABITAT_REF_LENGTH))
  })

  it('leaves no trailing space where the cut lands on one', () => {
    const ref = `${'C'.repeat(MAX_HABITAT_REF_LENGTH - 1)} tail`
    expect(cleanHabitatRef(ref)).toBe('C'.repeat(MAX_HABITAT_REF_LENGTH - 1))
  })

  it('changes nothing in a reference it has already cleaned', () => {
    const once = cleanHabitatRef(`  ${'D'.repeat(MAX_HABITAT_REF_LENGTH + 3)}`)
    expect(cleanHabitatRef(once)).toBe(once)
  })

  it('turns a number into its text, and leaves other values as they are', () => {
    expect(cleanHabitatRef(12)).toBe('12')
    expect(cleanHabitatRef(null)).toBeNull()
    expect(cleanHabitatRef(undefined)).toBeUndefined()
  })
})
