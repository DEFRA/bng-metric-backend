import { describe, expect, it } from 'vitest'

import { checkBaselineDistinctiveness } from './distinctiveness-check.js'
import { ERROR_CODES } from './errors.js'

const HABITAT_HIGH = 'Woodland and forest - Wet woodland'
const HABITAT_VHIGH = 'Grassland - Lowland meadows'
const SAMPLE_CAP = 50
const OFFENDER_TOTAL = 73
const SAMPLE_OVERFLOW = OFFENDER_TOTAL - SAMPLE_CAP
const HIGH_PARCEL_INDEX = 1
const VHIGH_PARCEL_INDEX = 3

function area(habitatType, extra = {}) {
  return {
    properties: {
      'Baseline Habitat Type': habitatType,
      ...extra
    }
  }
}

describe('checkBaselineDistinctiveness — in-scope habitats', () => {
  it('returns null when every habitat is Medium / Low / Very Low', () => {
    const layers = {
      areas: [
        area('Grassland - Modified grassland'), // Low
        area('Cropland - Arable field margins cultivated annually'), // Medium
        area('Urban - Developed land; sealed surface') // V.Low
      ]
    }
    expect(checkBaselineDistinctiveness(layers)).toBeNull()
  })

  it('returns null when the areas layer is missing or empty', () => {
    expect(checkBaselineDistinctiveness({})).toBeNull()
    expect(checkBaselineDistinctiveness({ areas: [] })).toBeNull()
    expect(checkBaselineDistinctiveness(null)).toBeNull()
  })

  it('returns null when habitat types are unrecognised (schema check upstream owns that)', () => {
    const layers = {
      areas: [area('Some made-up habitat that is not in the reference table')]
    }
    expect(checkBaselineDistinctiveness(layers)).toBeNull()
  })
})

describe('checkBaselineDistinctiveness — out-of-scope habitats', () => {
  it('rejects a High distinctiveness habitat with code + parcel ref in message', () => {
    const layers = {
      areas: [
        area('Woodland and forest - Lowland mixed deciduous woodland', {
          'Parcel Ref': 'PR-A',
          fid: 1
        })
      ]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err).not.toBeNull()
    expect(err.code).toBe(ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE)
    expect(err.message).toContain('Feature Ref PR-A')
    expect(err.details.count).toBe(1)
    expect(err.details.sample).toEqual([
      {
        idx: 0,
        fid: '1',
        feature_ref: 'PR-A',
        habitat_type: 'Woodland and forest - Lowland mixed deciduous woodland',
        distinctiveness: 'High'
      }
    ])
  })

  it('rejects a Very High distinctiveness habitat', () => {
    const layers = {
      areas: [area(HABITAT_VHIGH, { 'Parcel Ref': 'PR-B', fid: 2 })]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.code).toBe(ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE)
    expect(err.details.sample[0].distinctiveness).toBe('V.High')
    expect(err.details.sample[0].habitat_type).toBe(HABITAT_VHIGH)
  })

  it('lists every offending parcel in details.sample preserving layer order', () => {
    const layers = {
      areas: [
        area('Grassland - Modified grassland', { 'Parcel Ref': 'PR-OK' }),
        area(HABITAT_HIGH, { 'Parcel Ref': 'PR-1' }),
        area('Cropland - Cereal crops', { 'Parcel Ref': 'PR-OK-2' }),
        area(HABITAT_VHIGH, { 'Parcel Ref': 'PR-2' })
      ]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.details.count).toBe(2)
    expect(err.details.sample.map((s) => s.feature_ref)).toEqual([
      'PR-1',
      'PR-2'
    ])
    expect(err.details.sample.map((s) => s.idx)).toEqual([
      HIGH_PARCEL_INDEX,
      VHIGH_PARCEL_INDEX
    ])
  })

  it(`caps sample at ${SAMPLE_CAP} and appends "(and N more)" to the message when more offenders exist`, () => {
    const offenders = Array.from({ length: OFFENDER_TOTAL }, (_, i) =>
      area(HABITAT_HIGH, { 'Parcel Ref': `PR-${i}` })
    )
    const err = checkBaselineDistinctiveness({ areas: offenders })
    expect(err.details.count).toBe(OFFENDER_TOTAL)
    expect(err.details.sample).toHaveLength(SAMPLE_CAP)
    expect(err.message).toMatch(
      new RegExp(String.raw`\(and ${SAMPLE_OVERFLOW} more\)$`)
    )
  })
})

describe('checkBaselineDistinctiveness — feature label and property fallbacks', () => {
  it('falls back to fid when Parcel Ref is missing', () => {
    const layers = {
      areas: [area(HABITAT_HIGH, { fid: 7 })]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.message).toMatch(/fid 7/)
    expect(err.details.sample[0].feature_ref).toBeNull()
    expect(err.details.sample[0].fid).toBe('7')
  })

  it('falls back to feature #idx when both Parcel Ref and fid are missing', () => {
    const layers = {
      areas: [area(HABITAT_HIGH)]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.message).toMatch(/feature #0/)
  })

  it('accepts underscored Baseline_Habitat_Type property names', () => {
    const layers = {
      areas: [
        {
          properties: {
            Baseline_Habitat_Type: HABITAT_HIGH,
            Parcel_Ref: 'PR-U'
          }
        }
      ]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err).not.toBeNull()
    expect(err.details.sample[0].feature_ref).toBe('PR-U')
  })
})
