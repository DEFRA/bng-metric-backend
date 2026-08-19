import { describe, expect, it, vi } from 'vitest'

import * as referenceConstants from './reference-constants.js'
import * as validateModule from './validate.js'
import {
  getConditionMultiplier,
  getDifficultyLabel,
  getDifficultyMultiplier,
  getTimeMultiplier,
  getTimeToTargetValue,
  lookupHabitatDifficultyLabel,
  resolveDistinctiveness
} from './multipliers.js'

const H = 'Grassland - Modified grassland'
const H_30PLUS = 'Grassland - Lowland dry acid grassland'

// Habitats whose statutory creation table records Poor condition as "Not Possible"
// (no route to Poor). Regression fixtures for BMD-938.
const NO_POOR_ROUTE_CROPLAND = 'Cropland - Cereal crops'
const NO_POOR_ROUTE_CROPLAND_TARGET = 'Condition Assessment N/A'
// Felled has no Poor route AND its only valid target (Good) has a 30+ year
// time-to-target, so a mid-range advance reaches the Poor probe without hitting
// the "advance meets target => Low" override — exercising the middle branch.
const NO_POOR_ROUTE_FELLED = 'Woodland and forest - Felled'
const NO_POOR_ROUTE_FELLED_TARGET = 'Good'
const FELLED_ADVANCE_BELOW_TARGET = 5
// A habitat that genuinely discriminates the Creation and Enhancement difficulty
// branches: its Creation band (High) differs from its Enhancement band (Medium),
// its Poor target is achievable in 1 year, and the chosen end condition (Good)
// has a 15-year target so advance=1 does not trip the Low override.
const DISCRIMINATING_HABITAT =
  'Coastal saltmarsh - Saltmarshes and saline reedbeds'
const DISCRIMINATING_TARGET = 'Good'
const DIFFICULTY_HIGH = 0.33

// Statutory multiplier constants — extracted to avoid magic number literals
const MULTIPLIER_4_YRS = 0.8671800006
const MULTIPLIER_OVER_30_YRS = 0.3197967361
const DIFFICULTY_LOW = 1
const DIFFICULTY_MEDIUM = 0.67
const DIFFICULTY_CREATION = 0.33
const CONDITION_SCORE_MODERATE = 2
const DISTINCTIVENESS_SCORE_LOW = 2

describe('resolveDistinctiveness', () => {
  it('returns band label and score for a habitat', () => {
    expect(resolveDistinctiveness(H)).toEqual({
      distinctiveness: 'Low',
      distinctivenessScore: DISTINCTIVENESS_SCORE_LOW
    })
  })

  it('throws for invalid habitat', () => {
    expect(() => resolveDistinctiveness('__invalid__')).toThrow()
  })

  it('throws when distinctiveness category is missing in reference data', () => {
    const validateSpy = vi
      .spyOn(validateModule, 'validateHabitat')
      .mockImplementation(() => {})
    const categoriesSpy = vi.spyOn(
      referenceConstants,
      'DISTINCTIVENESS_CATEGORIES',
      'get'
    )
    categoriesSpy.mockReturnValue({})

    expect(() => resolveDistinctiveness(H)).toThrow(
      'Distinctiveness level not found for habitat'
    )

    validateSpy.mockRestore()
    categoriesSpy.mockRestore()
  })

  it('throws when distinctiveness score row is missing or not numeric', () => {
    const validateSpy = vi
      .spyOn(validateModule, 'validateHabitat')
      .mockImplementation(() => {})
    const categoriesSpy = vi.spyOn(
      referenceConstants,
      'DISTINCTIVENESS_CATEGORIES',
      'get'
    )
    categoriesSpy.mockReturnValue({ [H]: 'Low' })
    const scoresSpy = vi.spyOn(
      referenceConstants,
      'DISTINCTIVENESS_SCORES',
      'get'
    )
    scoresSpy.mockReturnValue({})

    expect(() => resolveDistinctiveness(H)).toThrow(
      'Distinctiveness data not found for habitat'
    )

    scoresSpy.mockReturnValue({ Low: { Score: 'not-a-number' } })
    expect(() => resolveDistinctiveness(H)).toThrow(
      'Distinctiveness data not found for habitat'
    )

    validateSpy.mockRestore()
    categoriesSpy.mockRestore()
    scoresSpy.mockRestore()
  })
})

describe('getConditionMultiplier', () => {
  it('returns multiplier for valid habitat and condition', () => {
    expect(getConditionMultiplier(H, 'Moderate')).toBe(CONDITION_SCORE_MODERATE)
  })

  it('throws for Not Possible condition value', () => {
    expect(() => getConditionMultiplier(H, 'Condition Assessment N/A')).toThrow(
      'is not a valid condition'
    )
  })

  it('throws TypeError when condition score is neither numeric nor Not Possible', () => {
    const spy = vi.spyOn(referenceConstants, 'CONDITION_SCORES', 'get')
    spy.mockReturnValue({
      ...referenceConstants.CONDITION_SCORES,
      [H]: {
        ...referenceConstants.CONDITION_SCORES[H],
        Moderate: 'invalid'
      }
    })

    expect(() => getConditionMultiplier(H, 'Moderate')).toThrow(TypeError)
    expect(() => getConditionMultiplier(H, 'Moderate')).toThrow(
      'Condition score is not a number'
    )

    spy.mockRestore()
  })
})

describe('getTimeToTargetValue', () => {
  it('Creation: reads years from reference and applies delay/advance', () => {
    expect(
      getTimeToTargetValue(H, 'Creation', undefined, 'Moderate', 0, 1)
    ).toBe('5')
    expect(
      getTimeToTargetValue(H, 'Creation', undefined, 'Moderate', 5, 0)
    ).toBe('0')
  })

  it('Creation: normalises "30+" reference values', () => {
    const v = getTimeToTargetValue(
      H_30PLUS,
      'Creation',
      undefined,
      'Good',
      0,
      0
    )
    expect(v).toBe('30')
  })

  it('Creation: caps result at >30 when delay pushes total', () => {
    const v = getTimeToTargetValue(
      H_30PLUS,
      'Creation',
      undefined,
      'Good',
      0,
      2
    )
    expect(v).toBe('>30')
  })

  it('Enhancement: throws when time-to-target is Not Possible', () => {
    expect(() =>
      getTimeToTargetValue(H, 'Enhancement', 'Lower', 'N/A - Other', 0, 0)
    ).toThrow("Time to target 'Not Possible'")
  })

  it('Enhancement: throws when path is missing in reference', () => {
    expect(() =>
      getTimeToTargetValue(H, 'Enhancement', 'Moderate', 'Moderate', 0, 0)
    ).toThrow('Time to target not found')
  })

  it('Creation: throws when time-to-target is Not Possible', () => {
    // 'Condition Assessment N/A' maps to 'Not Possible' in the creation table
    expect(() =>
      getTimeToTargetValue(
        H,
        'Creation',
        undefined,
        'Condition Assessment N/A',
        0,
        0
      )
    ).toThrow("Time to target 'Not Possible'")
  })

  it('Creation: throws when endCondition is missing from the reference table', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_CREATION', 'get')
    spy.mockReturnValue({ [H]: {} })
    try {
      expect(() =>
        getTimeToTargetValue(H, 'Creation', undefined, 'Moderate', 0, 0)
      ).toThrow('Time to target not found')
    } finally {
      spy.mockRestore()
    }
  })

  it('Creation: throws TypeError when reference value is not a number or "30+"', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_CREATION', 'get')
    spy.mockReturnValue({ [H]: { Moderate: 'unexpected-string' } })
    try {
      expect(() =>
        getTimeToTargetValue(H, 'Creation', undefined, 'Moderate', 0, 0)
      ).toThrow(TypeError)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('getTimeMultiplier', () => {
  it('returns multiplier from time-to-target value', () => {
    const m = getTimeMultiplier(H, 'Creation', undefined, 'Moderate', 0, 0)
    expect(m).toBe(MULTIPLIER_4_YRS)
  })

  it('throws when start condition missing for Enhancement', () => {
    expect(() =>
      getTimeMultiplier(H, 'Enhancement', '', 'Moderate', 0, 0)
    ).toThrow('Start condition not specified')
  })

  it('uses >30 multiplier bucket when time key exceeds 30', () => {
    const m = getTimeMultiplier(H_30PLUS, 'Creation', undefined, 'Good', 0, 2)
    expect(m).toBe(MULTIPLIER_OVER_30_YRS)
  })

  it('throws when time multiplier table has no entry for computed key', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_MULTIPLIER', 'get')
    spy.mockReturnValue({})
    expect(() =>
      getTimeMultiplier(H, 'Creation', undefined, 'Moderate', 0, 0)
    ).toThrow('Time multiplier not found')
    spy.mockRestore()
  })

  it('throws when time multiplier is Not Possible', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_MULTIPLIER', 'get')
    spy.mockReturnValue({
      ...referenceConstants.TIME_TO_TARGET_MULTIPLIER,
      4: 'Not Possible'
    })
    expect(() =>
      getTimeMultiplier(H, 'Creation', undefined, 'Moderate', 0, 0)
    ).toThrow('Time multiplier for habitat')
    spy.mockRestore()
  })
})

describe('getDifficultyMultiplier', () => {
  it('returns Low difficulty when advance meets time-to-target', () => {
    expect(getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 10, 0)).toBe(
      DIFFICULTY_LOW
    )
  })

  it('returns habitat difficulty when advance is below time-to-target', () => {
    expect(getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 0, 0)).toBe(
      DIFFICULTY_LOW
    )
  })

  it('reclassifies Creation as Enhancement for difficulty when advance clears poor target', () => {
    expect(getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 1, 0)).toBe(
      DIFFICULTY_LOW
    )
  })

  it('uses Enhancement difficulty band without Creation poor-target reclassification', () => {
    const spy = vi.spyOn(referenceConstants, 'HABITAT_DIFFICULTY', 'get')
    spy.mockReturnValue({
      ...referenceConstants.HABITAT_DIFFICULTY,
      [H]: { Creation: 'High', Enhancement: 'Medium' }
    })

    expect(
      getDifficultyMultiplier(H, 'Enhancement', 'Lower', 'Moderate', 0, 0)
    ).toBe(DIFFICULTY_MEDIUM)
    expect(getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 0, 0)).toBe(
      DIFFICULTY_CREATION
    )

    spy.mockRestore()
  })

  it('throws when Enhancement lacks start condition', () => {
    expect(() =>
      getDifficultyMultiplier(H, 'Enhancement', null, 'Moderate', 0, 0)
    ).toThrow('Start condition not specified')
  })

  it('throws when habitat has no difficulty reference row', () => {
    const spy = vi.spyOn(referenceConstants, 'HABITAT_DIFFICULTY', 'get')
    spy.mockReturnValue({
      ...referenceConstants.HABITAT_DIFFICULTY,
      [H]: undefined
    })
    expect(() =>
      getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 0, 0)
    ).toThrow('No difficulty reference data for habitat')
    spy.mockRestore()
  })

  it('throws when difficulty band is missing after enhancement reclassification', () => {
    const spy = vi.spyOn(referenceConstants, 'HABITAT_DIFFICULTY', 'get')
    spy.mockReturnValue({
      ...referenceConstants.HABITAT_DIFFICULTY,
      [H]: { Creation: 'Low' }
    })
    expect(() =>
      getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 1, 0)
    ).toThrow('Difficulty not found')
    spy.mockRestore()
  })

  it('throws when statutory difficulty multiplier is Not Possible', () => {
    const spy = vi.spyOn(referenceConstants, 'DIFFICULTY_MULTIPLIER', 'get')
    spy.mockReturnValue({
      ...referenceConstants.DIFFICULTY_MULTIPLIER,
      Low: 'Not Possible'
    })
    expect(() =>
      getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 10, 0)
    ).toThrow('Difficulty multiplier not found')
    spy.mockRestore()
  })
})

describe('getDifficultyLabel', () => {
  it('returns Low when advance meets time-to-target, even for High habitats', () => {
    expect(
      getDifficultyLabel(
        'Grassland - Lowland calcareous grassland',
        'Enhancement',
        'Lower',
        'Good',
        30,
        0
      )
    ).toBe('Low')
  })

  it('returns the habitat Enhancement band when advance does not meet target', () => {
    expect(
      getDifficultyLabel(
        'Grassland - Lowland calcareous grassland',
        'Enhancement',
        'Lower',
        'Good',
        0,
        0
      )
    ).toBe('High')
  })

  it('matches the band that getDifficultyMultiplier applies', () => {
    const habitat = 'Grassland - Lowland calcareous grassland'
    const label = getDifficultyLabel(
      habitat,
      'Enhancement',
      'Lower',
      'Good',
      0,
      0
    )
    expect(label).toBe('High')
    expect(
      getDifficultyMultiplier(habitat, 'Enhancement', 'Lower', 'Good', 0, 0)
    ).toBe(referenceConstants.DIFFICULTY_MULTIPLIER[label])
  })

  it('keeps label and multiplier on the Low band when advance meets time-to-target', () => {
    // Raw Enhancement difficulty for this habitat is High; advanceYears >=
    // time-to-target must force both the label and the multiplier to Low.
    const habitat = 'Grassland - Lowland calcareous grassland'
    const advanceYears = 30
    const label = getDifficultyLabel(
      habitat,
      'Enhancement',
      'Lower',
      'Good',
      advanceYears,
      0
    )
    expect(label).toBe('Low')
    expect(lookupHabitatDifficultyLabel(habitat, 'Enhancement')).toBe('High')
    expect(
      getDifficultyMultiplier(
        habitat,
        'Enhancement',
        'Lower',
        'Good',
        advanceYears,
        0
      )
    ).toBe(referenceConstants.DIFFICULTY_MULTIPLIER.Low)
  })
})

describe('lookupHabitatDifficultyLabel', () => {
  it('returns the Enhancement difficulty band for a habitat', () => {
    expect(lookupHabitatDifficultyLabel(H, 'Enhancement')).toBe('Low')
  })

  it('throws when habitat difficulty reference data is missing', () => {
    expect(() =>
      lookupHabitatDifficultyLabel('Not a valid habitat', 'Enhancement')
    ).toThrow('No difficulty reference data for habitat')
  })

  it('throws when the creation/enhancement band is missing', () => {
    expect(() => lookupHabitatDifficultyLabel(H, 'Unknown')).toThrow(
      'Difficulty not found for habitat'
    )
  })
})

// BMD-938: creating a habitat whose statutory creation table marks Poor as
// "Not Possible" must not throw while probing the Poor time-to-target. The probe
// answer cannot change the outcome for these habitats, so it resolves to the
// Creation band instead of aborting the whole calculation.
describe('creation difficulty for habitats with no route to Poor condition', () => {
  it('(a) resolves the Creation band at zero advance instead of throwing', () => {
    // Poor is "Not Possible" for cereal crops; at zero advance the habitat cannot
    // have reached Poor, so the Creation band applies with no error.
    expect(() =>
      getDifficultyLabel(
        NO_POOR_ROUTE_CROPLAND,
        'Creation',
        '',
        NO_POOR_ROUTE_CROPLAND_TARGET,
        0,
        0
      )
    ).not.toThrow()
    expect(
      getDifficultyMultiplier(
        NO_POOR_ROUTE_CROPLAND,
        'Creation',
        '',
        NO_POOR_ROUTE_CROPLAND_TARGET,
        0,
        0
      )
    ).toBe(DIFFICULTY_LOW)
  })

  it('(b) resolves the Creation band with advance below the target time-to-target', () => {
    // Felled: advance is above zero (so the zero-advance short-circuit does not
    // fire) yet below the 30+ year target (so the Low override does not fire),
    // reaching the Poor probe. Poor being unreachable must resolve to Creation.
    expect(() =>
      getDifficultyLabel(
        NO_POOR_ROUTE_FELLED,
        'Creation',
        '',
        NO_POOR_ROUTE_FELLED_TARGET,
        FELLED_ADVANCE_BELOW_TARGET,
        0
      )
    ).not.toThrow()
    expect(
      getDifficultyLabel(
        NO_POOR_ROUTE_FELLED,
        'Creation',
        '',
        NO_POOR_ROUTE_FELLED_TARGET,
        FELLED_ADVANCE_BELOW_TARGET,
        0
      )
    ).toBe(lookupHabitatDifficultyLabel(NO_POOR_ROUTE_FELLED, 'Creation'))
  })

  it('(c) discriminates Creation and Enhancement bands across the Poor boundary', () => {
    // At zero advance the Creation band (High) applies; at advance=1 the habitat
    // has cleared its 1-year Poor target, so the statutory rule reclassifies to
    // the Enhancement band (Medium). Both bands differ here, so this fails if the
    // branch selection is wrong — unlike the Modified-grassland cases where both
    // bands are Low.
    expect(
      getDifficultyLabel(
        DISCRIMINATING_HABITAT,
        'Creation',
        '',
        DISCRIMINATING_TARGET,
        0,
        0
      )
    ).toBe('High')
    expect(
      getDifficultyMultiplier(
        DISCRIMINATING_HABITAT,
        'Creation',
        '',
        DISCRIMINATING_TARGET,
        0,
        0
      )
    ).toBe(DIFFICULTY_HIGH)

    expect(
      getDifficultyLabel(
        DISCRIMINATING_HABITAT,
        'Creation',
        '',
        DISCRIMINATING_TARGET,
        1,
        0
      )
    ).toBe('Medium')
    expect(
      getDifficultyMultiplier(
        DISCRIMINATING_HABITAT,
        'Creation',
        '',
        DISCRIMINATING_TARGET,
        1,
        0
      )
    ).toBe(DIFFICULTY_MEDIUM)
  })
})
