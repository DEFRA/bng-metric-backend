import { describe, expect, it, vi } from 'vitest'

import * as referenceConstants from './reference-constants.js'
import * as validateModule from './validate.js'
import {
  getConditionMultiplier,
  getDifficultyMultiplier,
  getTimeMultiplier,
  getTimeToTargetValue,
  resolveDistinctiveness
} from './multipliers.js'

const H = 'Grassland - Modified grassland'
const H_30PLUS = 'Grassland - Lowland dry acid grassland'

describe('resolveDistinctiveness', () => {
  it('returns band label and score for a habitat', () => {
    expect(resolveDistinctiveness(H)).toEqual({
      distinctiveness: 'Low',
      distinctivenessScore: 2
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
    expect(getConditionMultiplier(H, 'Moderate')).toBe(2)
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
})

describe('getTimeMultiplier', () => {
  it('returns multiplier from time-to-target value', () => {
    const m = getTimeMultiplier(H, 'Creation', undefined, 'Moderate', 0, 0)
    expect(m).toBe(0.867)
  })

  it('throws when start condition missing for Enhancement', () => {
    expect(() =>
      getTimeMultiplier(H, 'Enhancement', '', 'Moderate', 0, 0)
    ).toThrow('Start condition not specified')
  })

  it('uses >30 multiplier bucket when time key exceeds 30', () => {
    const m = getTimeMultiplier(H_30PLUS, 'Creation', undefined, 'Good', 0, 2)
    expect(m).toBe(0.32)
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
      1
    )
  })

  it('returns habitat difficulty when advance is below time-to-target', () => {
    expect(getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 0, 0)).toBe(1)
  })

  it('reclassifies Creation as Enhancement for difficulty when advance clears poor target', () => {
    expect(getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 1, 0)).toBe(1)
  })

  it('uses Enhancement difficulty band without Creation poor-target reclassification', () => {
    const spy = vi.spyOn(referenceConstants, 'HABITAT_DIFFICULTY', 'get')
    spy.mockReturnValue({
      ...referenceConstants.HABITAT_DIFFICULTY,
      [H]: { Creation: 'High', Enhancement: 'Medium' }
    })

    expect(
      getDifficultyMultiplier(H, 'Enhancement', 'Lower', 'Moderate', 0, 0)
    ).toBe(0.67)
    expect(getDifficultyMultiplier(H, 'Creation', '', 'Moderate', 0, 0)).toBe(
      0.33
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
