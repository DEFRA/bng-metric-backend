import { describe, expect, it } from 'vitest'

import { checkBaselineDistinctiveness } from './distinctiveness-check.js'
import { ERROR_CODES } from './errors.js'

function area(habitatType, extra = {}) {
  return {
    properties: {
      'Baseline Habitat Type': habitatType,
      ...extra
    }
  }
}

describe('checkBaselineDistinctiveness', () => {
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
      areas: [
        area('Grassland - Lowland meadows', { 'Parcel Ref': 'PR-B', fid: 2 })
      ]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.code).toBe(ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE)
    expect(err.details.sample[0].distinctiveness).toBe('V.High')
    expect(err.details.sample[0].habitat_type).toBe(
      'Grassland - Lowland meadows'
    )
  })

  it('lists every offending parcel in details.sample preserving layer order', () => {
    const layers = {
      areas: [
        area('Grassland - Modified grassland', { 'Parcel Ref': 'PR-OK' }),
        area('Woodland and forest - Wet woodland', { 'Parcel Ref': 'PR-1' }), // High
        area('Cropland - Cereal crops', { 'Parcel Ref': 'PR-OK-2' }),
        area('Grassland - Lowland meadows', { 'Parcel Ref': 'PR-2' }) // V.High
      ]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.details.count).toBe(2)
    expect(err.details.sample.map((s) => s.feature_ref)).toEqual([
      'PR-1',
      'PR-2'
    ])
    expect(err.details.sample.map((s) => s.idx)).toEqual([1, 3])
  })

  it('caps sample at 50 and appends "(and N more)" to the message when more offenders exist', () => {
    const offenders = Array.from({ length: 73 }, (_, i) =>
      area('Woodland and forest - Wet woodland', { 'Parcel Ref': `PR-${i}` })
    )
    const err = checkBaselineDistinctiveness({ areas: offenders })
    expect(err.details.count).toBe(73)
    expect(err.details.sample).toHaveLength(50)
    expect(err.message).toMatch(/\(and 23 more\)$/)
  })

  it('falls back to fid when Parcel Ref is missing', () => {
    const layers = {
      areas: [
        area('Woodland and forest - Wet woodland', { fid: 7 }) // no Parcel Ref
      ]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.message).toMatch(/fid 7/)
    expect(err.details.sample[0].feature_ref).toBeNull()
    expect(err.details.sample[0].fid).toBe('7')
  })

  it('falls back to feature #idx when both Parcel Ref and fid are missing', () => {
    const layers = {
      areas: [area('Woodland and forest - Wet woodland')]
    }
    const err = checkBaselineDistinctiveness(layers)
    expect(err.message).toMatch(/feature #0/)
  })

  it('accepts underscored Baseline_Habitat_Type property names', () => {
    const layers = {
      areas: [
        {
          properties: {
            Baseline_Habitat_Type: 'Woodland and forest - Wet woodland',
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
