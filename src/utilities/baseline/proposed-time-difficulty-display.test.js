import { describe, expect, it } from 'vitest'

import {
  applyProposedTimeDifficultyDisplayFields,
  resolveAdvanceOrDelay,
  resolveFinalTimeToTargetCondition
} from './proposed-time-difficulty-display.js'

describe('resolveAdvanceOrDelay', () => {
  it('returns Advance when advance exceeds delay', () => {
    expect(resolveAdvanceOrDelay(5, 2)).toBe('Advance - 3 years')
  })

  it('returns Delay when delay exceeds advance', () => {
    expect(resolveAdvanceOrDelay(1, 4)).toBe('Delay - 3 years')
  })

  it('returns Neither when advance and delay are equal', () => {
    expect(resolveAdvanceOrDelay(2, 2)).toBe('Neither')
    expect(resolveAdvanceOrDelay(0, 0)).toBe('Neither')
    expect(resolveAdvanceOrDelay(null, null)).toBe('Neither')
  })
})

describe('resolveFinalTimeToTargetCondition', () => {
  it('combines standard years and time multiplier', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: '10',
        timeMultiplier: 0.67
      })
    ).toBe('10 years (0.67)')
  })

  it('accepts numeric standard years', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: 10,
        timeMultiplier: 1
      })
    ).toBe('10 years (1)')
  })

  it('returns null when standard years or time multiplier is missing', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: null,
        timeMultiplier: 1
      })
    ).toBeNull()
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: '10',
        timeMultiplier: null
      })
    ).toBeNull()
  })
})

describe('applyProposedTimeDifficultyDisplayFields', () => {
  it('writes both display fields when inputs are present', () => {
    const proposed = {
      advanceYears: 3,
      delayYears: 0,
      standardTimeToTargetCondition: '10',
      timeMultiplier: 1
    }
    applyProposedTimeDifficultyDisplayFields(proposed)
    expect(proposed.advanceOrDelay).toBe('Advance - 3 years')
    expect(proposed.finalTimeToTargetCondition).toBe('10 years (1)')
  })

  it('writes only advanceOrDelay when final-time inputs are incomplete', () => {
    const proposed = {
      advanceYears: 0,
      delayYears: 2
    }
    applyProposedTimeDifficultyDisplayFields(proposed)
    expect(proposed.advanceOrDelay).toBe('Delay - 2 years')
    expect(proposed.finalTimeToTargetCondition).toBeUndefined()
  })
})
