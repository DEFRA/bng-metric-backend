import { OVER_MAX_YEARS } from 'bng-library/metric'
import { describe, expect, it } from 'vitest'

import {
  applyProposedTimeDifficultyDisplayFields,
  resolveAdvanceOrDelay,
  resolveFinalTimeToTargetCondition
} from './proposed-time-difficulty-display.js'

const MULTIPLIER_30_PLUS = 0.3197967361
const MULTIPLIER_29 = 0.3558705807

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
  it('applies advance and delay to the standard years', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: '10',
        advanceYears: 2,
        delayYears: 1,
        timeMultiplier: 0.67
      })
    ).toBe('9 years (0.67)')
  })

  it('accepts numeric standard years', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: 10,
        advanceYears: 0,
        delayYears: 0,
        timeMultiplier: 1
      })
    ).toBe('10 years (1)')
  })

  it('returns null when standard years or time multiplier is missing', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: null,
        advanceYears: 0,
        delayYears: 0,
        timeMultiplier: 1
      })
    ).toBeNull()
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: '10',
        advanceYears: 0,
        delayYears: 0,
        timeMultiplier: null
      })
    ).toBeNull()
  })

  it('returns null when standard years is a non-numeric string', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: 'abc',
        advanceYears: 0,
        delayYears: 0,
        timeMultiplier: 1
      })
    ).toBeNull()
  })

  it('clamps to 0 when advance years exceed the statutory target', () => {
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: '4',
        advanceYears: 30,
        delayYears: 0,
        timeMultiplier: 1
      })
    ).toBe('0 years (1)')
  })

  it('words a delay past the maximum as "30+", as the metric does', () => {
    // bng-library/metric uses the "30+" multiplier here, not the 30-year one.
    expect(
      resolveFinalTimeToTargetCondition({
        standardTimeToTargetCondition: '25',
        advanceYears: 0,
        delayYears: 30,
        timeMultiplier: MULTIPLIER_30_PLUS
      })
    ).toBe(`30+ years (${MULTIPLIER_30_PLUS})`)
  })

  describe('a "30+" standard time to target (BMD-1040)', () => {
    it('stays "30+" with no advance or delay', () => {
      expect(
        resolveFinalTimeToTargetCondition({
          standardTimeToTargetCondition: OVER_MAX_YEARS,
          advanceYears: 0,
          delayYears: 0,
          timeMultiplier: MULTIPLIER_30_PLUS
        })
      ).toBe(`30+ years (${MULTIPLIER_30_PLUS})`)
    })

    it('counts down from 30 when advanced', () => {
      expect(
        resolveFinalTimeToTargetCondition({
          standardTimeToTargetCondition: OVER_MAX_YEARS,
          advanceYears: 1,
          delayYears: 0,
          timeMultiplier: MULTIPLIER_29
        })
      ).toBe(`29 years (${MULTIPLIER_29})`)
    })

    it('stays "30+" when delayed', () => {
      expect(
        resolveFinalTimeToTargetCondition({
          standardTimeToTargetCondition: OVER_MAX_YEARS,
          advanceYears: 0,
          delayYears: 2,
          timeMultiplier: MULTIPLIER_30_PLUS
        })
      ).toBe(`30+ years (${MULTIPLIER_30_PLUS})`)
    })
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
    expect(proposed.finalTimeToTargetCondition).toBe('7 years (1)')
  })

  it('writes the final time for an advanced "30+" habitat', () => {
    // Before BMD-1040 the standard was "30"; now it is ">30", and an advanced
    // tree or line of trees lost its final time to target entirely.
    const proposed = {
      advanceYears: 1,
      delayYears: 0,
      standardTimeToTargetCondition: OVER_MAX_YEARS,
      timeMultiplier: MULTIPLIER_29
    }
    applyProposedTimeDifficultyDisplayFields(proposed)
    expect(proposed.finalTimeToTargetCondition).toBe(
      `29 years (${MULTIPLIER_29})`
    )
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
