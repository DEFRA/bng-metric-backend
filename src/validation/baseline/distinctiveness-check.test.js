import { describe, expect, it } from 'vitest'

import { checkHabitatDistinctiveness } from './distinctiveness-check.js'
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

describe('checkHabitatDistinctiveness — in-scope habitats', () => {
  it('returns null when every habitat is Medium / Low / Very Low', () => {
    const layers = {
      areas: [
        area('Grassland - Modified grassland'), // Low
        area('Cropland - Arable field margins cultivated annually'), // Medium
        area('Urban - Developed land; sealed surface') // V.Low
      ]
    }
    expect(checkHabitatDistinctiveness(layers)).toBeNull()
  })

  it('returns null when the areas layer is missing or empty', () => {
    expect(checkHabitatDistinctiveness({})).toBeNull()
    expect(checkHabitatDistinctiveness({ areas: [] })).toBeNull()
    expect(checkHabitatDistinctiveness(null)).toBeNull()
  })

  it('returns null when habitat types are unrecognised (schema check upstream owns that)', () => {
    const layers = {
      areas: [area('Some made-up habitat that is not in the reference table')]
    }
    expect(checkHabitatDistinctiveness(layers)).toBeNull()
  })
})

describe('checkHabitatDistinctiveness — out-of-scope habitats', () => {
  it('rejects a High distinctiveness habitat with code + parcel ref in message', () => {
    const layers = {
      areas: [area(HABITAT_HIGH, { 'Parcel Ref': 'PR-A', fid: 1 })]
    }
    const err = checkHabitatDistinctiveness(layers)
    expect(err).not.toBeNull()
    expect(err.code).toBe(ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE)
    expect(err.message).toContain('Feature Ref PR-A')
    expect(err.details.count).toBe(1)
    expect(err.details.allowedBands).toEqual(['Medium', 'Low', 'V.Low'])
    expect(err.details.sample).toEqual([
      {
        idx: 0,
        fid: '1',
        feature_ref: 'PR-A',
        habitat_type: HABITAT_HIGH,
        distinctiveness: 'High'
      }
    ])
  })

  it('rejects a Very High distinctiveness habitat', () => {
    const layers = {
      areas: [area(HABITAT_VHIGH, { 'Parcel Ref': 'PR-B', fid: 2 })]
    }
    const err = checkHabitatDistinctiveness(layers)
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
    const err = checkHabitatDistinctiveness(layers)
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
    const err = checkHabitatDistinctiveness({ areas: offenders })
    expect(err.details.count).toBe(OFFENDER_TOTAL)
    expect(err.details.sample).toHaveLength(SAMPLE_CAP)
    expect(err.message).toMatch(
      new RegExp(String.raw`\(and ${SAMPLE_OVERFLOW} more\)$`)
    )
  })
})

describe('checkHabitatDistinctiveness — feature label and property fallbacks', () => {
  it('falls back to fid when Parcel Ref is missing', () => {
    const layers = {
      areas: [area(HABITAT_HIGH, { fid: 7 })]
    }
    const err = checkHabitatDistinctiveness(layers)
    expect(err.message).toMatch(/fid 7/)
    expect(err.details.sample[0].feature_ref).toBeNull()
    expect(err.details.sample[0].fid).toBe('7')
  })

  it('falls back to feature #idx when both Parcel Ref and fid are missing', () => {
    const layers = {
      areas: [area(HABITAT_HIGH)]
    }
    const err = checkHabitatDistinctiveness(layers)
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
    const err = checkHabitatDistinctiveness(layers)
    expect(err).not.toBeNull()
    expect(err.details.sample[0].feature_ref).toBe('PR-U')
  })
})

describe('checkHabitatDistinctiveness — real GeoPackage column layout', () => {
  // Real QGIS-authored GeoPackages split the habitat name across two columns:
  // Baseline Broad Habitat Type holds "Grassland", Baseline Habitat Type holds
  // "Lowland meadows". The lookup needs to combine them; before the fix the
  // check ran a Type-only lookup that always returned null and the validator
  // silently passed every file.
  it('detects an out-of-scope habitat when broad and type are in separate columns', () => {
    const layers = {
      areas: [
        {
          properties: {
            'Baseline Broad Habitat Type': 'Grassland',
            'Baseline Habitat Type': 'Lowland meadows',
            'Parcel Ref': 'PR-A',
            fid: 1
          }
        }
      ]
    }
    const err = checkHabitatDistinctiveness(layers)
    expect(err).not.toBeNull()
    expect(err.code).toBe(ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE)
    expect(err.details.sample[0]).toEqual({
      idx: 0,
      fid: '1',
      feature_ref: 'PR-A',
      habitat_type: 'Grassland - Lowland meadows',
      distinctiveness: 'V.High'
    })
  })

  it('returns null for in-scope habitats with split columns', () => {
    const layers = {
      areas: [
        {
          properties: {
            'Baseline Broad Habitat Type': 'Grassland',
            'Baseline Habitat Type': 'Modified grassland'
          }
        }
      ]
    }
    expect(checkHabitatDistinctiveness(layers)).toBeNull()
  })
})

describe('checkHabitatDistinctiveness — hedgerow and watercourse layers', () => {
  // BMD-352 originally scanned only the area layer, so V.High/High hedgerows
  // and watercourses slipped into the service. All three families must be
  // gated against their own reference vocabulary.
  it('rejects a Very High distinctiveness watercourse (Priority habitat river)', () => {
    const layers = {
      watercourses: [
        {
          properties: {
            'Baseline River Type': 'Priority habitat', // V.High
            'Parcel Ref': 'WC-1',
            fid: 5
          }
        }
      ]
    }
    const err = checkHabitatDistinctiveness(layers)
    expect(err).not.toBeNull()
    expect(err.code).toBe(ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE)
    expect(err.details.sample[0]).toEqual({
      idx: 0,
      fid: '5',
      feature_ref: 'WC-1',
      habitat_type: 'Priority habitat',
      distinctiveness: 'V.High'
    })
  })

  it('rejects a High distinctiveness watercourse (Other rivers and streams)', () => {
    const layers = {
      watercourses: [
        {
          properties: {
            Baseline_River_Type: 'Other rivers and streams', // High
            Parcel_Ref: 'WC-2'
          }
        }
      ]
    }
    const err = checkHabitatDistinctiveness(layers)
    expect(err.details.sample[0].distinctiveness).toBe('High')
    expect(err.details.sample[0].feature_ref).toBe('WC-2')
  })

  it('returns null for an in-scope watercourse (Ditches)', () => {
    const layers = {
      watercourses: [
        { properties: { 'Baseline River Type': 'Ditches' } } // Medium
      ]
    }
    expect(checkHabitatDistinctiveness(layers)).toBeNull()
  })

  it('rejects a Very High distinctiveness hedgerow', () => {
    const layers = {
      hedgerows: [
        {
          properties: {
            'Baseline Hedge Type':
              'Species-rich native hedgerow with trees - associated with bank or ditch', // V.High
            'Parcel Ref': 'HR-1',
            fid: 9
          }
        }
      ]
    }
    const err = checkHabitatDistinctiveness(layers)
    expect(err).not.toBeNull()
    expect(err.details.sample[0].distinctiveness).toBe('V.High')
    expect(err.details.sample[0].feature_ref).toBe('HR-1')
  })

  it('returns null for an in-scope hedgerow (Native hedgerow)', () => {
    const layers = {
      hedgerows: [
        { properties: { 'Baseline Hedge Type': 'Native hedgerow' } } // Low
      ]
    }
    expect(checkHabitatDistinctiveness(layers)).toBeNull()
  })

  it('aggregates offenders across area, hedgerow and watercourse layers', () => {
    const layers = {
      areas: [area(HABITAT_HIGH, { 'Parcel Ref': 'PR-1' })],
      hedgerows: [
        {
          properties: {
            'Baseline Hedge Type': 'Species-rich native hedgerow with trees', // High
            'Parcel Ref': 'HR-1'
          }
        }
      ],
      watercourses: [
        {
          properties: {
            'Baseline River Type': 'Priority habitat', // V.High
            'Parcel Ref': 'WC-1'
          }
        }
      ]
    }
    const err = checkHabitatDistinctiveness(layers)
    expect(err.details.count).toBe(3)
    expect(err.details.sample.map((s) => s.feature_ref)).toEqual([
      'PR-1',
      'HR-1',
      'WC-1'
    ])
  })

  it('reads Proposed columns for hedgerows and watercourses under postIntervention', () => {
    const layers = {
      hedgerows: [
        {
          properties: {
            'Baseline Hedge Type': 'Native hedgerow', // Low, must be ignored
            'Proposed Hedge Type': 'Species-rich native hedgerow with trees' // High
          }
        }
      ],
      watercourses: [
        {
          properties: {
            'Baseline River Type': 'Ditches', // Medium, must be ignored
            'Proposed River Type': 'Priority habitat' // V.High
          }
        }
      ]
    }
    const err = checkHabitatDistinctiveness(layers, 'postIntervention')
    expect(err.details.count).toBe(2)
    expect(err.details.sample.map((s) => s.distinctiveness)).toEqual([
      'High',
      'V.High'
    ])
  })
})

describe('checkHabitatDistinctiveness — post-intervention variant', () => {
  // The High/Very-High exclusion is a whole-service scope limit, so for the
  // post-intervention document the check must read the Proposed* columns and
  // gate them the same way it gates Baseline* columns.
  it('rejects an out-of-scope Proposed habitat when variant is postIntervention', () => {
    const layers = {
      areas: [
        {
          properties: {
            'Proposed Broad Habitat Type': 'Grassland',
            'Proposed Habitat Type': 'Lowland meadows', // V.High
            'Parcel Ref': 'PR-A',
            fid: 1
          }
        }
      ]
    }
    const err = checkHabitatDistinctiveness(layers, 'postIntervention')
    expect(err).not.toBeNull()
    expect(err.code).toBe(ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE)
    expect(err.details.sample[0]).toEqual({
      idx: 0,
      fid: '1',
      feature_ref: 'PR-A',
      habitat_type: 'Grassland - Lowland meadows',
      distinctiveness: 'V.High'
    })
  })

  it('ignores the Baseline* columns when checking the post-intervention variant', () => {
    // Baseline columns are out-of-scope, Proposed columns are in-scope: the
    // post-intervention check must follow the Proposed columns and pass.
    const layers = {
      areas: [
        {
          properties: {
            'Baseline Broad Habitat Type': 'Grassland',
            'Baseline Habitat Type': 'Lowland meadows', // V.High — must be ignored
            'Proposed Broad Habitat Type': 'Grassland',
            'Proposed Habitat Type': 'Modified grassland' // Low — in scope
          }
        }
      ]
    }
    expect(checkHabitatDistinctiveness(layers, 'postIntervention')).toBeNull()
  })

  it('still reads Baseline* columns for the default (baseline) variant', () => {
    const layers = {
      areas: [
        {
          properties: {
            'Baseline Broad Habitat Type': 'Grassland',
            'Baseline Habitat Type': 'Lowland meadows', // V.High
            'Proposed Habitat Type': 'Modified grassland' // in scope, ignored
          }
        }
      ]
    }
    expect(checkHabitatDistinctiveness(layers)).not.toBeNull()
  })
})
