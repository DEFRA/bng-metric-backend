import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.js'
import {
  DEFAULT_ENCROACHMENT_MULTIPLIER,
  isDistinctivenessEnhancement,
  isRecognisedEncroachmentValue,
  normaliseEncroachmentLabel,
  resolveEncroachmentMultiplier,
  resolveEnhancedLinearLengths,
  resolveLinearConditionScore,
  resolveLinearDistinctiveness,
  resolveRequiredEncroachmentMultiplier,
  validateLinearLength
} from './linear-resolvers.js'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER
} from './reference-constants.js'

// Encroachment multiplier for minor/no-encroachment fixture
const MINOR_MULTIPLIER = 0.8

const NATIVE_HEDGEROW = 'Native hedgerow'
const GOOD = 'Good'
const MODERATE = 'Moderate'

// ---------------------------------------------------------------------------
// isDistinctivenessEnhancement
// ---------------------------------------------------------------------------

describe('isDistinctivenessEnhancement', () => {
  it('returns true when post-intervention score is higher than baseline', () => {
    expect(isDistinctivenessEnhancement(2, 4)).toBe(true)
  })

  it('returns false when post-intervention score equals baseline', () => {
    expect(isDistinctivenessEnhancement(2, 2)).toBe(false)
  })

  it('returns false when post-intervention score is lower than baseline', () => {
    expect(isDistinctivenessEnhancement(4, 2)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_ENCROACHMENT_MULTIPLIER
// ---------------------------------------------------------------------------

describe('DEFAULT_ENCROACHMENT_MULTIPLIER', () => {
  it('equals 1 (no encroachment penalty)', () => {
    expect(DEFAULT_ENCROACHMENT_MULTIPLIER).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// resolveLinearDistinctiveness
// ---------------------------------------------------------------------------

describe('resolveLinearDistinctiveness', () => {
  it('returns distinctiveness band and score for a valid hedge type', () => {
    const result = resolveLinearDistinctiveness(
      NATIVE_HEDGEROW,
      HEDGEROW_DISTINCTIVENESS_CATEGORIES,
      HEDGEROW_DISTINCTIVENESS_SCORES,
      'hedgerow'
    )
    expect(result.distinctiveness).toBe('Low')
    expect(result.distinctivenessScore).toBe(2)
  })

  it('throws BaselineLookupError for an empty type string', () => {
    expect(() =>
      resolveLinearDistinctiveness(
        '',
        HEDGEROW_DISTINCTIVENESS_CATEGORIES,
        HEDGEROW_DISTINCTIVENESS_SCORES,
        'hedgerow'
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an unrecognised type', () => {
    expect(() =>
      resolveLinearDistinctiveness(
        'Not a hedgerow',
        HEDGEROW_DISTINCTIVENESS_CATEGORIES,
        HEDGEROW_DISTINCTIVENESS_SCORES,
        'hedgerow'
      )
    ).toThrow(BaselineLookupError)
  })
})

// ---------------------------------------------------------------------------
// resolveLinearConditionScore
// ---------------------------------------------------------------------------

describe('resolveLinearConditionScore', () => {
  it('returns the numeric condition score for a valid hedge type and condition', () => {
    const score = resolveLinearConditionScore(
      NATIVE_HEDGEROW,
      GOOD,
      HEDGEROW_CONDITION_SCORES,
      'hedgerow'
    )
    expect(typeof score).toBe('number')
    expect(score).toBeGreaterThan(0)
  })

  it('throws BaselineLookupError for an empty condition string', () => {
    expect(() =>
      resolveLinearConditionScore(
        NATIVE_HEDGEROW,
        '',
        HEDGEROW_CONDITION_SCORES,
        'hedgerow'
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an unrecognised condition', () => {
    expect(() =>
      resolveLinearConditionScore(
        NATIVE_HEDGEROW,
        'Not a condition',
        HEDGEROW_CONDITION_SCORES,
        'hedgerow'
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError when the hedge type has no condition scores', () => {
    expect(() =>
      resolveLinearConditionScore(
        'Not a hedgerow',
        MODERATE,
        HEDGEROW_CONDITION_SCORES,
        'hedgerow'
      )
    ).toThrow(BaselineLookupError)
  })
})

// ---------------------------------------------------------------------------
// normaliseEncroachmentLabel
// ---------------------------------------------------------------------------

describe('normaliseEncroachmentLabel', () => {
  it('strips a leading numeric prefix', () => {
    expect(normaliseEncroachmentLabel('2. Minor/No Encroachment')).toBe(
      'Minor/No Encroachment'
    )
  })

  it('returns trimmed value when no prefix is present', () => {
    expect(normaliseEncroachmentLabel('  Minor  ')).toBe('Minor')
  })

  it('collapses spaces around slash separators', () => {
    expect(normaliseEncroachmentLabel('3. Minor/ No Encroachment')).toBe(
      'Minor/No Encroachment'
    )
  })
})

// ---------------------------------------------------------------------------
// validateLinearLength
// ---------------------------------------------------------------------------

describe('validateLinearLength', () => {
  it('accepts a positive finite length', () => {
    expect(() => validateLinearLength(1, 'Hedgerow')).not.toThrow()
  })

  it('throws TypeError for zero, negative, and non-numeric length', () => {
    expect(() => validateLinearLength(0, 'Watercourse')).toThrow(TypeError)
    expect(() => validateLinearLength(-1, 'Watercourse')).toThrow(TypeError)
    expect(() => validateLinearLength('one', 'Watercourse')).toThrow(TypeError)
  })

  it('throws TypeError for Infinity', () => {
    expect(() => validateLinearLength(Infinity, 'Hedgerow')).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// resolveEncroachmentMultiplier
// ---------------------------------------------------------------------------

describe('resolveEncroachmentMultiplier', () => {
  it('returns DEFAULT_ENCROACHMENT_MULTIPLIER for null, undefined, and empty string', () => {
    expect(
      resolveEncroachmentMultiplier(
        null,
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toBe(DEFAULT_ENCROACHMENT_MULTIPLIER)
    expect(
      resolveEncroachmentMultiplier(
        '',
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toBe(DEFAULT_ENCROACHMENT_MULTIPLIER)
  })

  it('looks up known values after stripping a numeric prefix', () => {
    expect(
      resolveEncroachmentMultiplier(
        'Minor',
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toBe(MINOR_MULTIPLIER)
  })

  it('throws BaselineLookupError for unknown values', () => {
    expect(() =>
      resolveEncroachmentMultiplier(
        'None',
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for non-string values', () => {
    expect(() =>
      resolveEncroachmentMultiplier(
        42,
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toThrow(BaselineLookupError)
  })
})

// ---------------------------------------------------------------------------
// resolveRequiredEncroachmentMultiplier
// ---------------------------------------------------------------------------

describe('resolveRequiredEncroachmentMultiplier', () => {
  it('throws BaselineLookupError when value is null or empty', () => {
    expect(() =>
      resolveRequiredEncroachmentMultiplier(
        null,
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toThrow(BaselineLookupError)
    expect(() =>
      resolveRequiredEncroachmentMultiplier(
        '',
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toThrow(BaselineLookupError)
  })

  it('looks up known values', () => {
    expect(
      resolveRequiredEncroachmentMultiplier(
        'Minor',
        WATERCOURSE_ENCROACHMENT_MULTIPLIER,
        'watercourse encroachment'
      )
    ).toBe(MINOR_MULTIPLIER)
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
// resolveEnhancedLinearLengths
// ---------------------------------------------------------------------------

describe('resolveEnhancedLinearLengths', () => {
  it('returns both lengths unchanged when post-intervention exceeds baseline', () => {
    const result = resolveEnhancedLinearLengths(1, 2)
    expect(result).toEqual({ baselineLengthKm: 1, postInterventionLengthKm: 2 })
  })

  it('clamps both lengths to post-intervention when post-intervention is shorter', () => {
    const result = resolveEnhancedLinearLengths(2, 1)
    expect(result).toEqual({ baselineLengthKm: 1, postInterventionLengthKm: 1 })
  })

  it('returns equal lengths unchanged when both are the same', () => {
    const result = resolveEnhancedLinearLengths(1.5, 1.5)
    expect(result).toEqual({
      baselineLengthKm: 1.5,
      postInterventionLengthKm: 1.5
    })
  })
})
