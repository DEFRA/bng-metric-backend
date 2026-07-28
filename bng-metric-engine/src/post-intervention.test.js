import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.js'
import {
  calculateCreatedAreaHabitatPostIntervention,
  calculateEnhancedAreaHabitatPostIntervention,
  calculateRetainedAreaHabitatPostIntervention
} from './post-intervention.js'

const H = 'Grassland - Modified grassland'

// Statutory multiplier constants — extracted to avoid magic number literals
const MULTIPLIER_4_YRS = 0.8671800006
const MULTIPLIER_ENHANCEMENT = 0.7002822742
const MULTIPLIER_HIGH_DIST_ENHANCEMENT = 0.343
const DIFFICULTY_LOW = 1
const DIFFICULTY_CREATION = 0.33
const DISTINCTIVENESS_LOW = 'Low'
const DISTINCTIVENESS_HIGH = 'High'
const DISTINCTIVENESS_SCORE_LOW = 2
const DISTINCTIVENESS_SCORE_HIGH = 6
const CONDITION_SCORE_MODERATE = 2
const CONDITION_SCORE_GOOD = 3
const STRATEGIC_SIGNIFICANCE = 1

describe('calculateRetainedAreaHabitatPostIntervention', () => {
  it('returns correct units for a Low distinctiveness habitat in Moderate condition', () => {
    const result = calculateRetainedAreaHabitatPostIntervention(
      100,
      H,
      'Moderate'
    )
    expect(result.units).toBe(400)
    expect(result.distinctiveness).toBe(DISTINCTIVENESS_LOW)
    expect(result.distinctivenessScore).toBe(DISTINCTIVENESS_SCORE_LOW)
    expect(result.conditionScore).toBe(CONDITION_SCORE_MODERATE)
    expect(result.strategicSignificanceScore).toBe(STRATEGIC_SIGNIFICANCE)
  })

  it('throws for zero size', () => {
    expect(() =>
      calculateRetainedAreaHabitatPostIntervention(0, H, 'Moderate')
    ).toThrow('Size must be a finite number greater than 0')
  })

  it('throws BaselineLookupError for an unrecognised habitat type', () => {
    expect(() =>
      calculateRetainedAreaHabitatPostIntervention(
        1,
        'Not a valid habitat',
        'Moderate'
      )
    ).toThrow(BaselineLookupError)
  })
})

describe('calculateCreatedAreaHabitatPostIntervention', () => {
  it('calculates units for Grassland creation in Moderate condition', () => {
    const result = calculateCreatedAreaHabitatPostIntervention(
      1,
      H,
      'Moderate',
      0,
      0
    )
    expect(result.units).toBeCloseTo(3.468)
    expect(result.distinctiveness).toBe(DISTINCTIVENESS_LOW)
    expect(result.distinctivenessScore).toBe(DISTINCTIVENESS_SCORE_LOW)
    expect(result.conditionScore).toBe(CONDITION_SCORE_MODERATE)
    expect(result.timeMultiplier).toBe(MULTIPLIER_4_YRS)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
  })
})

describe('calculateEnhancedAreaHabitatPostIntervention', () => {
  it('calculates units for Lower to Moderate enhancement', () => {
    const result = calculateEnhancedAreaHabitatPostIntervention(
      1,
      H,
      H,
      'Lower',
      'Moderate',
      0,
      0
    )
    expect(result.units).toBeCloseTo(3.4)
    expect(result.postInterventionDistinctiveness).toBe(DISTINCTIVENESS_LOW)
    expect(result.postInterventionDistinctivenessScore).toBe(
      DISTINCTIVENESS_SCORE_LOW
    )
    expect(result.postInterventionConditionScore).toBe(CONDITION_SCORE_MODERATE)
    expect(result.timeMultiplier).toBe(MULTIPLIER_ENHANCEMENT)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
    expect(result.standardTimeToTargetCondition).toBe('10')
    expect(result.difficulty).toBe('Low')
  })

  it('uses Lower time-to-target start when enhancing to higher distinctiveness habitat', () => {
    const result = calculateEnhancedAreaHabitatPostIntervention(
      1,
      H,
      'Grassland - Lowland calcareous grassland',
      'Moderate',
      'Good',
      0,
      0
    )
    expect(result.units).toBeCloseTo(5.585)
    expect(result.postInterventionDistinctiveness).toBe(DISTINCTIVENESS_HIGH)
    expect(result.postInterventionDistinctivenessScore).toBe(
      DISTINCTIVENESS_SCORE_HIGH
    )
    expect(result.postInterventionConditionScore).toBe(CONDITION_SCORE_GOOD)
    expect(result.timeMultiplier).toBeCloseTo(MULTIPLIER_HIGH_DIST_ENHANCEMENT)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_CREATION)
    expect(result.standardTimeToTargetCondition).toBe('30')
    expect(result.difficulty).toBe('High')
  })

  it('calculates units for Moderate to Good enhancement', () => {
    const result = calculateEnhancedAreaHabitatPostIntervention(
      1,
      H,
      H,
      'Moderate',
      'Good',
      0,
      0
    )
    expect(result.units).toBeCloseTo(5.4)
    expect(result.postInterventionDistinctiveness).toBe(DISTINCTIVENESS_LOW)
    expect(result.postInterventionDistinctivenessScore).toBe(
      DISTINCTIVENESS_SCORE_LOW
    )
    expect(result.postInterventionConditionScore).toBe(CONDITION_SCORE_GOOD)
    expect(result.timeMultiplier).toBe(MULTIPLIER_ENHANCEMENT)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
    expect(result.standardTimeToTargetCondition).toBe('10')
    expect(result.difficulty).toBe('Low')
  })

  it('forces difficulty to Low when advance years meet the time-to-target', () => {
    // Same habitat as the High-band case above (advanceYears 0 → difficulty
    // High / difficultyMultiplier Creation). With advanceYears covering the
    // 30-year target, both the display label and the unit multiplier must
    // follow the Low override — not the raw Enhancement band.
    const result = calculateEnhancedAreaHabitatPostIntervention(
      1,
      H,
      'Grassland - Lowland calcareous grassland',
      'Moderate',
      'Good',
      30,
      0
    )
    expect(result.standardTimeToTargetCondition).toBe('30')
    expect(result.difficulty).toBe('Low')
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_LOW)
  })
})

describe('advance and delay on the same area habitat', () => {
  // Statutory tool: advance and delayed creation cannot both be used on one
  // habitat. Saltmarsh is the clearest case — left unrejected, the pair walks the
  // difficulty multiplier through all three bands while the timing never changes.
  const SALTMARSH = 'Coastal saltmarsh - Saltmarshes and saline reedbeds'
  const BOTH_REJECTED = /cannot both be used on the same habitat/

  it('rejects the pair when creating', () => {
    expect(() =>
      calculateCreatedAreaHabitatPostIntervention(1, SALTMARSH, 'Good', 1, 1)
    ).toThrow(BOTH_REJECTED)
    expect(() =>
      calculateCreatedAreaHabitatPostIntervention(1, SALTMARSH, 'Good', 30, 30)
    ).toThrow(BOTH_REJECTED)
  })

  it('rejects the pair when enhancing', () => {
    expect(() =>
      calculateEnhancedAreaHabitatPostIntervention(
        1,
        SALTMARSH,
        SALTMARSH,
        'Poor',
        'Good',
        5,
        5
      )
    ).toThrow(BOTH_REJECTED)
  })

  it('still scores each on its own', () => {
    const advanced = calculateCreatedAreaHabitatPostIntervention(
      1,
      SALTMARSH,
      'Good',
      1,
      0
    )
    const delayed = calculateCreatedAreaHabitatPostIntervention(
      1,
      SALTMARSH,
      'Good',
      0,
      1
    )
    expect(advanced.units).toBeGreaterThan(delayed.units)
  })
})
