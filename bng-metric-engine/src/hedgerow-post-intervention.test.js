import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.js'
import {
  calculateCreatedHedgerowPostIntervention,
  calculateEnhancedHedgerowPostIntervention,
  calculateRetainedHedgerowPostIntervention
} from './hedgerow-post-intervention.js'

// Statutory multiplier constants — extracted to avoid magic number literals
const MULTIPLIER_30_YRS = 0.8368287006
const MULTIPLIER_10_YRS = 0.898632125
const MULTIPLIER_2_YRS = 0.931225
const DIFFICULTY_LOW = 1
const DISTINCTIVENESS_LOW = 'Low'
const DISTINCTIVENESS_MEDIUM = 'Medium'
const DISTINCTIVENESS_SCORE_LOW = 2
const DISTINCTIVENESS_SCORE_MEDIUM = 4
const CONDITION_SCORE_MODERATE = 2
const CONDITION_SCORE_GOOD = 3
const STRATEGIC_SIGNIFICANCE = 1

describe('calculateRetainedHedgerowPostIntervention', () => {
  it('returns correct units for a Low distinctiveness hedgerow in Good condition', () => {
    const result = calculateRetainedHedgerowPostIntervention(
      0.5,
      'Native hedgerow',
      'Good'
    )
    expect(result.units).toBe(3)
    expect(result.distinctiveness).toBe(DISTINCTIVENESS_LOW)
    expect(result.distinctivenessScore).toBe(DISTINCTIVENESS_SCORE_LOW)
    expect(result.conditionScore).toBe(CONDITION_SCORE_GOOD)
    expect(result.strategicSignificanceScore).toBe(STRATEGIC_SIGNIFICANCE)
  })

  it('throws TypeError for zero length', () => {
    expect(() =>
      calculateRetainedHedgerowPostIntervention(0, 'Native hedgerow', 'Good')
    ).toThrow(TypeError)
  })

  it('throws BaselineLookupError for an unrecognised hedge type', () => {
    expect(() =>
      calculateRetainedHedgerowPostIntervention(
        1,
        'Not a valid hedge type',
        'Good'
      )
    ).toThrow(BaselineLookupError)
  })
})

describe('calculateCreatedHedgerowPostIntervention', () => {
  it('calculates units for Native hedgerow creation in Moderate condition', () => {
    const result = calculateCreatedHedgerowPostIntervention(
      1,
      'Native hedgerow',
      'Moderate',
      0,
      0
    )
    expect(result.units).toBeCloseTo(3.348)
    expect(result.distinctiveness).toBe(DISTINCTIVENESS_LOW)
    expect(result.distinctivenessScore).toBe(DISTINCTIVENESS_SCORE_LOW)
    expect(result.conditionScore).toBe(CONDITION_SCORE_MODERATE)
    expect(result.timeMultiplier).toBe(MULTIPLIER_30_YRS)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
  })
})

describe('calculateEnhancedHedgerowPostIntervention', () => {
  it('calculates units for Poor to Moderate enhancement', () => {
    const result = calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      'Native hedgerow',
      'Native hedgerow',
      'Poor',
      'Moderate',
      { advanceYears: 0, delayYears: 0 }
    )
    expect(result.units).toBeCloseTo(3.798)
    expect(result.postInterventionDistinctiveness).toBe(DISTINCTIVENESS_LOW)
    expect(result.postInterventionDistinctivenessScore).toBe(
      DISTINCTIVENESS_SCORE_LOW
    )
    expect(result.postInterventionConditionScore).toBe(CONDITION_SCORE_MODERATE)
    expect(result.timeMultiplier).toBe(MULTIPLIER_10_YRS)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
  })

  it('uses creation time-to-target when enhancing to higher distinctiveness from Poor', () => {
    const result = calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      'Native hedgerow',
      'Species-rich native hedgerow',
      'Poor',
      'Moderate',
      { advanceYears: 0, delayYears: 0 }
    )
    expect(result.units).toBeCloseTo(7.02)
    expect(result.postInterventionDistinctiveness).toBe(DISTINCTIVENESS_MEDIUM)
    expect(result.postInterventionDistinctivenessScore).toBe(
      DISTINCTIVENESS_SCORE_MEDIUM
    )
    expect(result.postInterventionConditionScore).toBe(CONDITION_SCORE_MODERATE)
    expect(result.timeMultiplier).toBe(MULTIPLIER_30_YRS)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
    expect(result.standardTimeToTargetCondition).toBe('5')
    expect(result.difficulty).toBe('Low')
  })

  it('uses Poor enhancement time-to-target start for higher distinctiveness above Poor', () => {
    const result = calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      'Native hedgerow',
      'Species-rich native hedgerow',
      'Moderate',
      'Good',
      { advanceYears: 0, delayYears: 0 }
    )
    expect(result.units).toBeCloseTo(10.696)
    expect(result.postInterventionDistinctiveness).toBe(DISTINCTIVENESS_MEDIUM)
    expect(result.postInterventionDistinctivenessScore).toBe(
      DISTINCTIVENESS_SCORE_MEDIUM
    )
    expect(result.postInterventionConditionScore).toBe(CONDITION_SCORE_GOOD)
    expect(result.timeMultiplier).toBe(MULTIPLIER_30_YRS)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
  })

  it('applies advance years to reduce time-to-target', () => {
    // Native hedgerow Moderate→Good has a reference time-to-target of 2 years.
    // Advancing by 2 years meets the target, giving timeMultiplier of 1 and
    // difficultyMultiplier of Low (1). Units = ((2*3 - 2*2) * 1 + 2*2) * 1 = 6.
    const result = calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      'Native hedgerow',
      'Native hedgerow',
      'Moderate',
      'Good',
      { advanceYears: 2, delayYears: 0 }
    )
    expect(result.units).toBe(6)
    expect(result.timeMultiplier).toBe(1)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
    expect(result.standardTimeToTargetCondition).toBe('2')
    expect(result.difficulty).toBe('Low')
  })

  it('uses baseline length for baseline value when post-intervention length is greater', () => {
    const sameLength = calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      'Native hedgerow',
      'Native hedgerow',
      'Moderate',
      'Good',
      { advanceYears: 0, delayYears: 0 }
    )
    const extended = calculateEnhancedHedgerowPostIntervention(
      1,
      2,
      'Native hedgerow',
      'Native hedgerow',
      'Moderate',
      'Good',
      { advanceYears: 0, delayYears: 0 }
    )
    expect(extended.units).toBeGreaterThan(sameLength.units)
  })

  it('throws TypeError for zero baseline length', () => {
    expect(() =>
      calculateEnhancedHedgerowPostIntervention(
        0,
        1,
        'Native hedgerow',
        'Native hedgerow',
        'Poor',
        'Moderate',
        { advanceYears: 0, delayYears: 0 }
      )
    ).toThrow(TypeError)
  })

  it('throws BaselineLookupError for an unrecognised hedge type', () => {
    expect(() =>
      calculateEnhancedHedgerowPostIntervention(
        1,
        1,
        'Not a valid hedge type',
        'Native hedgerow',
        'Poor',
        'Moderate',
        { advanceYears: 0, delayYears: 0 }
      )
    ).toThrow(BaselineLookupError)
  })

  it('pins statutory unit calculation for Species-rich native hedgerow Moderate → Good', () => {
    // Verified against BNG metric statutory tool (hedgerow worksheet):
    //   Enhancement time-to-target (Moderate → Good) = 2 years
    //   TIME_TO_TARGET_MULTIPLIER["2"]               = 0.931225
    //   Difficulty                                   = Low (1.0)
    //   Distinctiveness score (Medium)               = 4
    //   Condition scores: Moderate = 2, Good = 3
    //   Strategic significance                       = 1
    //
    //   postValue     = 1.0 × 4 × 3 = 12
    //   baselineValue = 1.0 × 4 × 2 = 8
    //   units = ((12 - 8) × 0.931225 × 1.0 + 8) × 1 = 11.7249
    const result = calculateEnhancedHedgerowPostIntervention(
      1.0,
      1.0,
      'Species-rich native hedgerow',
      'Species-rich native hedgerow',
      'Moderate',
      'Good',
      { advanceYears: 0, delayYears: 0 }
    )
    expect(result.units).toBe(11.7249)
    expect(result.timeMultiplier).toBe(MULTIPLIER_2_YRS)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
    expect(result.standardTimeToTargetCondition).toBe('2')
    expect(result.difficulty).toBe('Low')
    expect(result.postInterventionDistinctivenessScore).toBe(
      DISTINCTIVENESS_SCORE_MEDIUM
    )
    expect(result.postInterventionConditionScore).toBe(CONDITION_SCORE_GOOD)
    expect(result.strategicSignificanceScore).toBe(STRATEGIC_SIGNIFICANCE)
  })
})
