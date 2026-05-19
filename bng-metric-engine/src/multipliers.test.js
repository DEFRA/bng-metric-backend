import { describe, expect, it, vi } from 'vitest'

import * as referenceConstants from './reference-constants.js'
import {
  getConditionMultiplier,
  getDifficultyMultiplier,
  getDistinctivenessMultiplier,
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
})

describe('getDistinctivenessMultiplier', () => {
  it('returns numeric score only', () => {
    expect(getDistinctivenessMultiplier(H)).toBe(2)
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
})

describe('getTimeToTargetValue', () => {
  it('Creation: reads years from reference and applies delay/advance', () => {
    expect(
      getTimeToTargetValue(H, 'Creation', undefined, 'Moderate', 1, 0)
    ).toBe(5)
    expect(
      getTimeToTargetValue(H, 'Creation', undefined, 'Moderate', 0, 5)
    ).toBe(0)
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
    expect(v).toBe(30)
  })

  it('Creation: caps result at >30 when delay pushes total', () => {
    const v = getTimeToTargetValue(
      H_30PLUS,
      'Creation',
      undefined,
      'Good',
      2,
      0
    )
    expect(v).toBe('>30')
  })

  it('Enhancement: maps Not Possible time-to-target to 1', () => {
    const v = getTimeToTargetValue(
      H,
      'Enhancement',
      'Lower',
      'N/A - Other',
      0,
      0
    )
    expect(v).toBe(1)
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
    const m = getTimeMultiplier(H_30PLUS, 'Creation', undefined, 'Good', 2, 0)
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

  it('throws when Enhancement lacks start condition', () => {
    expect(() =>
      getDifficultyMultiplier(H, 'Enhancement', null, 'Moderate', 0, 0)
    ).toThrow('Start condition not specified')
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
