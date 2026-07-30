import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.js'
import {
  calculateCreatedWatercoursePostIntervention,
  calculateEnhancedWatercoursePostIntervention,
  calculateRetainedWatercoursePostIntervention
} from './watercourse-post-intervention.js'

const DIFFICULTY_CREATION = 0.33
const DIFFICULTY_MEDIUM = 0.67

describe('calculateRetainedWatercoursePostIntervention', () => {
  it('returns correct units with no encroachment (defaults to 1)', () => {
    const result = calculateRetainedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Good'
    )
    expect(result.units).toBeCloseTo(24)
    expect(result.distinctiveness).toBe('V.High')
    expect(result.distinctivenessScore).toBe(8)
    expect(result.conditionScore).toBe(3)
    expect(result.waterEncroachmentMultiplier).toBe(1)
    expect(result.riparianEncroachmentMultiplier).toBe(1)
    expect(result.strategicSignificanceScore).toBe(1)
  })

  it('applies watercourse and riparian encroachment multipliers', () => {
    const result = calculateRetainedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Good',
      'Minor',
      'Minor/No Encroachment'
    )
    expect(result.waterEncroachmentMultiplier).toBe(0.8)
    expect(result.riparianEncroachmentMultiplier).toBe(0.98)
    expect(result.units).toBeCloseTo(18.816)
  })

  it('throws TypeError for zero length', () => {
    expect(() =>
      calculateRetainedWatercoursePostIntervention(
        0,
        'Priority habitat',
        'Good'
      )
    ).toThrow(TypeError)
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      calculateRetainedWatercoursePostIntervention(
        1,
        'Not a valid watercourse type',
        'Good'
      )
    ).toThrow(BaselineLookupError)
  })
})

describe('calculateCreatedWatercoursePostIntervention', () => {
  it('calculates units for Priority habitat creation in Moderate condition', () => {
    const result = calculateCreatedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Moderate',
      'Minor',
      'Minor/No Encroachment'
    )
    expect(result.units).toBeCloseTo(3.46477)
    expect(result.distinctiveness).toBe('V.High')
    expect(result.distinctivenessScore).toBe(8)
    expect(result.conditionScore).toBe(2)
    expect(result.timeMultiplier).toBe(0.8368287006)
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_CREATION)
    expect(result.standardTimeToTargetCondition).toBe('5')
    expect(result.difficulty).toBe('High')
  })

  it('reclassifies difficulty to the Enhancement band once advance clears the Poor target', () => {
    // Priority habitat Poor time-to-target is 1 year, so advanceYears: 1
    // reclassifies Creation difficulty (High) to the Enhancement band
    // (Medium) — difficulty and difficultyMultiplier must stay consistent.
    const result = calculateCreatedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Moderate',
      'Minor',
      'Minor/No Encroachment',
      1,
      0
    )
    expect(result.standardTimeToTargetCondition).toBe('5')
    expect(result.difficulty).toBe('Medium')
    expect(result.difficultyMultiplier).toBe(DIFFICULTY_MEDIUM)
  })

  it('defaults advanceYears and delayYears to 0 when omitted', () => {
    const withDefaults = calculateCreatedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Moderate',
      'No Encroachment',
      'No Encroachment/No Encroachment'
    )
    const withExplicitZeros = calculateCreatedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Moderate',
      'No Encroachment',
      'No Encroachment/No Encroachment',
      0,
      0
    )
    expect(withDefaults.units).toBeCloseTo(withExplicitZeros.units)
    expect(withDefaults.units).toBeCloseTo(4.41936)
  })

  it('throws BaselineLookupError when watercourse encroachment is omitted', () => {
    expect(() =>
      calculateCreatedWatercoursePostIntervention(
        1,
        'Priority habitat',
        'Moderate',
        null,
        'Minor/No Encroachment'
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError when riparian encroachment is omitted', () => {
    expect(() =>
      calculateCreatedWatercoursePostIntervention(
        1,
        'Priority habitat',
        'Moderate',
        'Minor',
        ''
      )
    ).toThrow(BaselineLookupError)
  })
})

describe('calculateEnhancedWatercoursePostIntervention', () => {
  it('calculates units for Poor to Moderate enhancement with post-intervention encroachment', () => {
    const result = calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Priority habitat',
      'Priority habitat',
      'Poor',
      'Moderate',
      {
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/No Encroachment',
        advanceYears: 0,
        delayYears: 0
      }
    )
    expect(result.units).toBeCloseTo(9.91534208)
    expect(result.postInterventionDistinctiveness).toBe('V.High')
    expect(result.postInterventionDistinctivenessScore).toBe(8)
    expect(result.postInterventionConditionScore).toBe(2)
    expect(result.postInterventionWaterEncroachmentMultiplier).toBe(0.8)
    expect(result.postInterventionRiparianEncroachmentMultiplier).toBe(0.98)
    expect(result.timeMultiplier).toBe(0.8671800006)
    expect(result.difficultyMultiplier).toBe(0.67)
    expect(result.standardTimeToTargetCondition).toBe('4')
    expect(result.difficulty).toBe('Medium')
  })

  it('matches spreadsheet units for cross-type distinctiveness enhancement from Poor baseline', () => {
    const result = calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Ditches',
      'Priority habitat',
      'Poor',
      'Moderate',
      {
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment',
        advanceYears: 0,
        delayYears: 0
      }
    )
    expect(result.timeMultiplier).toBe(0.8368287006)
    expect(result.difficultyMultiplier).toBe(0.33)
    expect(result.units).toBeCloseTo(7.31384)
    expect(result.standardTimeToTargetCondition).toBe('5')
    expect(result.difficulty).toBe('High')
  })

  it('matches spreadsheet units for cross-type distinctiveness enhancement', () => {
    const result = calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Ditches',
      'Priority habitat',
      'Moderate',
      'Good',
      {
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment',
        advanceYears: 0,
        delayYears: 0
      }
    )
    expect(result.units).toBeCloseTo(15.504)
    expect(result.timeMultiplier).toBe(0.7002822742)
    expect(result.difficultyMultiplier).toBe(0.67)
    expect(result.standardTimeToTargetCondition).toBe('10')
    expect(result.difficulty).toBe('Medium')
  })

  it('matches spreadsheet units for Moderate to Good with advance years', () => {
    const result = calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Priority habitat',
      'Priority habitat',
      'Moderate',
      'Good',
      {
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment',
        advanceYears: 2,
        delayYears: 0
      }
    )
    expect(result.units).toBeCloseTo(20.99)
    expect(result.timeMultiplier).toBe(0.931225)
    expect(result.difficultyMultiplier).toBe(0.67)
    // Statutory value ignores the applied 2-year advance, unlike timeMultiplier's bucket.
    expect(result.standardTimeToTargetCondition).toBe('4')
    expect(result.difficulty).toBe('Medium')
  })

  it('uses baseline length for baseline value when post-intervention length is greater', () => {
    const result = calculateEnhancedWatercoursePostIntervention(
      1,
      2,
      'Priority habitat',
      'Priority habitat',
      'Moderate',
      'Good',
      { advanceYears: 0, delayYears: 0 }
    )
    // post value 2*8*3=48, baseline value 1*8*2=16, gain=32, RT=0.8671800006*0.67
    expect(result.units).toBeCloseTo(34.58848)
  })

  it('applies post-intervention encroachment multipliers only at the end of the formula', () => {
    const withoutEncroachment = calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Priority habitat',
      'Priority habitat',
      'Poor',
      'Moderate',
      { advanceYears: 0, delayYears: 0 }
    )
    const withEncroachment = calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Priority habitat',
      'Priority habitat',
      'Poor',
      'Moderate',
      {
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/No Encroachment',
        advanceYears: 0,
        delayYears: 0
      }
    )

    expect(withoutEncroachment.units).toBeCloseTo(12.64712)
    expect(withEncroachment.units).toBeCloseTo(
      withoutEncroachment.units * 0.8 * 0.98
    )
  })
})

describe('advance and delay on the same watercourse', () => {
  // Watercourses move the opposite way to area habitats — the pair makes a
  // created ditch score worse, not better — so they need their own cover.
  const BOTH_REJECTED = /cannot both be used on the same habitat/

  it('rejects the pair when creating', () => {
    expect(() =>
      calculateCreatedWatercoursePostIntervention(
        1,
        'Ditches',
        'Good',
        'No Encroachment',
        'No Encroachment/No Encroachment',
        30,
        30
      )
    ).toThrow(BOTH_REJECTED)
  })

  it('still scores advance on its own', () => {
    const result = calculateCreatedWatercoursePostIntervention(
      1,
      'Ditches',
      'Good',
      'No Encroachment',
      'No Encroachment/No Encroachment',
      30,
      0
    )
    expect(result.units).toBeGreaterThan(0)
  })
})
