import { describe, expect, it, vi } from 'vitest'

import { BaselineLookupError } from './errors.js'
import {
  calculateHedgerowBaseline,
  calculateWatercourseBaseline,
  isRecognisedEncroachmentValue
} from './linear-baseline.js'
import { WATERCOURSE_ENCROACHMENT_MULTIPLIER } from './reference-constants.js'
import * as referenceConstants from './reference-constants.js'

// ---------------------------------------------------------------------------
// calculateHedgerowBaseline
// ---------------------------------------------------------------------------

describe('calculateHedgerowBaseline', () => {
  it('returns correct units for a High distinctiveness hedgerow in Good condition', () => {
    // 0.5 km × 6 (High) × 3 (Good) × 1 = 9
    const result = calculateHedgerowBaseline(
      0.5,
      'Species-rich native hedgerow with trees',
      'Good'
    )
    expect(result.units).toBeCloseTo(9)
    expect(result.distinctiveness).toBe('High')
    expect(result.distinctivenessScore).toBe(6)
    expect(result.conditionScore).toBe(3)
    expect(result.strategicSignificanceScore).toBe(1)
  })

  it('returns correct units for a Medium distinctiveness hedgerow in Moderate condition', () => {
    // 1 km × 4 (Medium) × 2 (Moderate) × 1 = 8
    const result = calculateHedgerowBaseline(
      1,
      'Species-rich native hedgerow',
      'Moderate'
    )
    expect(result.units).toBeCloseTo(8)
    expect(result.distinctiveness).toBe('Medium')
    expect(result.distinctivenessScore).toBe(4)
    expect(result.conditionScore).toBe(2)
  })

  it('returns correct units for a Low distinctiveness hedgerow in Poor condition', () => {
    // 2 km × 2 (Low) × 1 (Poor) × 1 = 4
    const result = calculateHedgerowBaseline(2, 'Native hedgerow', 'Poor')
    expect(result.units).toBeCloseTo(4)
    expect(result.distinctiveness).toBe('Low')
    expect(result.distinctivenessScore).toBe(2)
    expect(result.conditionScore).toBe(1)
  })

  it('throws BaselineLookupError when condition is Not Possible for the hedge type', () => {
    expect(() =>
      calculateHedgerowBaseline(1, 'Native hedgerow with trees', 'Fairly Good')
    ).toThrow(BaselineLookupError)
  })

  it('throws TypeError for zero length', () => {
    expect(() =>
      calculateHedgerowBaseline(0, 'Native hedgerow', 'Good')
    ).toThrow(TypeError)
  })

  it('throws TypeError for negative length', () => {
    expect(() =>
      calculateHedgerowBaseline(-1, 'Native hedgerow', 'Good')
    ).toThrow(TypeError)
  })

  it('throws TypeError for non-numeric length', () => {
    expect(() =>
      calculateHedgerowBaseline('one', 'Native hedgerow', 'Good')
    ).toThrow(TypeError)
  })

  it('throws BaselineLookupError for an unrecognised hedge type', () => {
    expect(() =>
      calculateHedgerowBaseline(1, 'Not a valid hedge type', 'Good')
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an unrecognised condition', () => {
    expect(() =>
      calculateHedgerowBaseline(1, 'Native hedgerow', 'Not a valid condition')
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an empty hedge type', () => {
    expect(() => calculateHedgerowBaseline(1, '', 'Good')).toThrow(
      BaselineLookupError
    )
  })

  it('throws BaselineLookupError when the distinctiveness scores map has no numeric score for the band', () => {
    const spy = vi.spyOn(
      referenceConstants,
      'HEDGEROW_DISTINCTIVENESS_SCORES',
      'get'
    )
    spy.mockReturnValue({})
    try {
      expect(() =>
        calculateHedgerowBaseline(1, 'Native hedgerow', 'Good')
      ).toThrow(BaselineLookupError)
    } finally {
      spy.mockRestore()
    }
  })

  it('throws BaselineLookupError when condition scores table has no entry for the hedge type', () => {
    const spy = vi.spyOn(referenceConstants, 'HEDGEROW_CONDITION_SCORES', 'get')
    spy.mockReturnValue({})
    try {
      expect(() =>
        calculateHedgerowBaseline(1, 'Native hedgerow', 'Good')
      ).toThrow(BaselineLookupError)
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// isRecognisedEncroachmentValue
// ---------------------------------------------------------------------------

describe('isRecognisedEncroachmentValue', () => {
  it('treats null, undefined, and empty string as recognised', () => {
    expect(
      isRecognisedEncroachmentValue(null, WATERCOURSE_ENCROACHMENT_MULTIPLIER)
    ).toBe(true)
    expect(
      isRecognisedEncroachmentValue(
        undefined,
        WATERCOURSE_ENCROACHMENT_MULTIPLIER
      )
    ).toBe(true)
    expect(
      isRecognisedEncroachmentValue('', WATERCOURSE_ENCROACHMENT_MULTIPLIER)
    ).toBe(true)
  })

  it('recognises known values after stripping a numeric prefix', () => {
    expect(
      isRecognisedEncroachmentValue(
        'Minor',
        WATERCOURSE_ENCROACHMENT_MULTIPLIER
      )
    ).toBe(true)
    expect(
      isRecognisedEncroachmentValue(
        '2. Minor',
        WATERCOURSE_ENCROACHMENT_MULTIPLIER
      )
    ).toBe(true)
  })

  it('rejects unknown string and non-string values', () => {
    expect(
      isRecognisedEncroachmentValue('None', WATERCOURSE_ENCROACHMENT_MULTIPLIER)
    ).toBe(false)
    expect(
      isRecognisedEncroachmentValue(42, WATERCOURSE_ENCROACHMENT_MULTIPLIER)
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// calculateWatercourseBaseline
// ---------------------------------------------------------------------------

describe('calculateWatercourseBaseline', () => {
  it('returns correct units with no encroachment (defaults to 1)', () => {
    // 1 km × 8 (V.High) × 3 (Good) × 1 × 1 × 1 = 24
    const result = calculateWatercourseBaseline(1, 'Priority habitat', 'Good')
    expect(result.units).toBeCloseTo(24)
    expect(result.distinctiveness).toBe('V.High')
    expect(result.distinctivenessScore).toBe(8)
    expect(result.conditionScore).toBe(3)
    expect(result.waterEncroachmentMultiplier).toBe(1)
    expect(result.riparianEncroachmentMultiplier).toBe(1)
    expect(result.strategicSignificanceScore).toBe(1)
  })

  it('returns correct units for a High distinctiveness watercourse in Moderate condition', () => {
    // 0.5 km × 6 (High) × 2 (Moderate) × 1 × 1 × 1 = 6
    const result = calculateWatercourseBaseline(
      0.5,
      'Other rivers and streams',
      'Moderate'
    )
    expect(result.units).toBeCloseTo(6)
    expect(result.distinctiveness).toBe('High')
    expect(result.distinctivenessScore).toBe(6)
    expect(result.conditionScore).toBe(2)
  })

  it('returns correct units for a Medium distinctiveness watercourse in Poor condition', () => {
    // 2 km × 4 (Medium) × 1 (Poor) × 1 × 1 × 1 = 8
    const result = calculateWatercourseBaseline(2, 'Ditches', 'Poor')
    expect(result.units).toBeCloseTo(8)
    expect(result.distinctiveness).toBe('Medium')
  })

  it('applies watercourse encroachment multiplier', () => {
    // 1 km × 8 × 3 × 0.8 (Minor) × 1 × 1 = 19.2
    const result = calculateWatercourseBaseline(
      1,
      'Priority habitat',
      'Good',
      'Minor'
    )
    expect(result.waterEncroachmentMultiplier).toBe(0.8)
    expect(result.units).toBeCloseTo(19.2)
  })

  it('applies riparian encroachment multiplier', () => {
    // 1 km × 8 × 3 × 1 × 0.98 (Minor/No Encroachment) × 1 = 23.52
    const result = calculateWatercourseBaseline(
      1,
      'Priority habitat',
      'Good',
      null,
      'Minor/No Encroachment'
    )
    expect(result.riparianEncroachmentMultiplier).toBe(0.98)
    expect(result.units).toBeCloseTo(23.52)
  })

  it('strips leading numeric prefix from riparian encroachment before lookup', () => {
    // "2. Minor/No Encroachment" → "Minor/No Encroachment" → 0.98
    const result = calculateWatercourseBaseline(
      1,
      'Priority habitat',
      'Good',
      null,
      '2. Minor/No Encroachment'
    )
    expect(result.riparianEncroachmentMultiplier).toBe(0.98)
  })

  it('applies both encroachment multipliers together', () => {
    // 1 km × 8 × 3 × 0.8 (Minor) × 0.98 (Minor/No Encroachment) × 1 = 18.816
    const result = calculateWatercourseBaseline(
      1,
      'Priority habitat',
      'Good',
      'Minor',
      'Minor/No Encroachment'
    )
    expect(result.units).toBeCloseTo(18.816)
  })

  it('handles Fairly Good and Fairly Poor condition scores', () => {
    const fairlyGood = calculateWatercourseBaseline(
      1,
      'Priority habitat',
      'Fairly Good'
    )
    expect(fairlyGood.conditionScore).toBe(2.5)

    const fairlyPoor = calculateWatercourseBaseline(
      1,
      'Priority habitat',
      'Fairly Poor'
    )
    expect(fairlyPoor.conditionScore).toBe(1.5)
  })

  it('throws TypeError for zero length', () => {
    expect(() =>
      calculateWatercourseBaseline(0, 'Priority habitat', 'Good')
    ).toThrow(TypeError)
  })

  it('throws TypeError for infinite length', () => {
    expect(() =>
      calculateWatercourseBaseline(Infinity, 'Priority habitat', 'Good')
    ).toThrow(TypeError)
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      calculateWatercourseBaseline(1, 'Not a valid watercourse type', 'Good')
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an unrecognised condition', () => {
    expect(() =>
      calculateWatercourseBaseline(1, 'Priority habitat', 'N/A - Other')
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an invalid watercourse encroachment value', () => {
    expect(() =>
      calculateWatercourseBaseline(
        1,
        'Priority habitat',
        'Good',
        'Not a valid encroachment'
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an invalid riparian encroachment value', () => {
    expect(() =>
      calculateWatercourseBaseline(
        1,
        'Priority habitat',
        'Good',
        null,
        'Not a valid riparian value'
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for null watercourse type', () => {
    expect(() => calculateWatercourseBaseline(1, null, 'Good')).toThrow(
      BaselineLookupError
    )
  })

  it('throws BaselineLookupError for an empty-string condition', () => {
    expect(() =>
      calculateWatercourseBaseline(1, 'Priority habitat', '')
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError when the condition type key is not in the scores table', () => {
    // "Priority habitat" is valid but empty condition triggers the type-lookup path
    expect(() =>
      calculateWatercourseBaseline(1, 'Priority habitat', null)
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for a non-string encroachment value', () => {
    expect(() =>
      calculateWatercourseBaseline(1, 'Priority habitat', 'Good', 42)
    ).toThrow(BaselineLookupError)
  })
})
