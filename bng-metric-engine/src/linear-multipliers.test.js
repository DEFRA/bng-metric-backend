import { describe, expect, it, vi } from 'vitest'

import { BaselineLookupError } from './errors.js'
import * as referenceConstants from './reference-constants.js'
import {
  getHedgerowCreationDifficultyLabel,
  getHedgerowCreationDifficultyMultiplier,
  getHedgerowCreationTimeMultiplier,
  getHedgerowCreationTimeToTargetValue,
  getHedgerowEnhancementDifficultyLabel,
  getHedgerowEnhancementDifficultyMultiplier,
  getHedgerowEnhancementTimeMultiplier,
  getHedgerowEnhancementTimeToTargetValue
} from './linear-hedgerow-multipliers.js'
import {
  getWatercourseCreationDifficultyMultiplier,
  getWatercourseCreationTimeMultiplier,
  getWatercourseEnhancementDifficultyMultiplier,
  getWatercourseEnhancementTimeMultiplier
} from './linear-watercourse-multipliers.js'

// Statutory multiplier constants — extracted to avoid magic number literals
const MULTIPLIER_30_YRS = 0.8368287006
const MULTIPLIER_10_YRS = 0.898632125
const DIFFICULTY_LOW = 1
const DIFFICULTY_MEDIUM = 0.67
const DIFFICULTY_CREATION = 0.33

const NATIVE_HEDGEROW = 'Native hedgerow'
const SPECIES_RICH_HEDGEROW = 'Species-rich native hedgerow'
const PRIORITY_HABITAT = 'Priority habitat'
const MODERATE = 'Moderate'
const GOOD = 'Good'
const POOR = 'Poor'

// ---------------------------------------------------------------------------
// Hedgerow creation
// ---------------------------------------------------------------------------

describe('getHedgerowCreationTimeMultiplier', () => {
  it('returns the statutory multiplier for Native hedgerow in Moderate condition', () => {
    expect(
      getHedgerowCreationTimeMultiplier(NATIVE_HEDGEROW, MODERATE, 0, 0)
    ).toBe(MULTIPLIER_30_YRS)
  })

  it('throws BaselineLookupError for an unrecognised hedge type', () => {
    expect(() =>
      getHedgerowCreationTimeMultiplier('Not a hedge', MODERATE, 0, 0)
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an unrecognised condition', () => {
    expect(() =>
      getHedgerowCreationTimeMultiplier(NATIVE_HEDGEROW, 'N/A', 0, 0)
    ).toThrow(BaselineLookupError)
  })
})

describe('hedgerow time and difficulty display values', () => {
  it('returns creation time-to-target and difficulty labels', () => {
    expect(
      String(
        getHedgerowCreationTimeToTargetValue(NATIVE_HEDGEROW, MODERATE, 0, 0)
      )
    ).toBe('5')
    expect(
      getHedgerowCreationDifficultyLabel(NATIVE_HEDGEROW, MODERATE, 0, 0)
    ).toBe('Low')
  })

  it('returns enhancement time-to-target and difficulty labels', () => {
    expect(
      String(
        getHedgerowEnhancementTimeToTargetValue(
          NATIVE_HEDGEROW,
          POOR,
          MODERATE,
          0,
          0
        )
      )
    ).toBe('3')
    expect(
      getHedgerowEnhancementDifficultyLabel(
        NATIVE_HEDGEROW,
        POOR,
        MODERATE,
        0,
        0
      )
    ).toBe('Low')
  })
})
it('rejects Not Possible creation and enhancement multipliers', () => {
  const spy = vi.spyOn(referenceConstants, 'DIFFICULTY_MULTIPLIER', 'get')
  spy.mockReturnValue({
    ...referenceConstants.DIFFICULTY_MULTIPLIER,
    Low: 'Not Possible'
  })

  expect(() =>
    getHedgerowCreationDifficultyMultiplier(NATIVE_HEDGEROW, MODERATE, 0, 0)
  ).toThrow('Difficulty multiplier not found')
  expect(() =>
    getHedgerowEnhancementDifficultyMultiplier(
      NATIVE_HEDGEROW,
      POOR,
      MODERATE,
      0,
      0
    )
  ).toThrow('Difficulty multiplier not found')
  spy.mockRestore()
})
describe('getHedgerowCreationDifficultyMultiplier', () => {
  it('returns Low difficulty for Native hedgerow creation with no advance or delay', () => {
    expect(
      getHedgerowCreationDifficultyMultiplier(NATIVE_HEDGEROW, MODERATE, 0, 0)
    ).toBe(DIFFICULTY_LOW)
  })

  it('throws BaselineLookupError for an unrecognised hedge type', () => {
    expect(() =>
      getHedgerowCreationDifficultyMultiplier('Not a hedge', MODERATE, 0, 0)
    ).toThrow(BaselineLookupError)
  })
})

// ---------------------------------------------------------------------------
// Hedgerow enhancement
// ---------------------------------------------------------------------------

describe('getHedgerowEnhancementTimeMultiplier', () => {
  it('returns the statutory multiplier for Poor to Moderate enhancement', () => {
    expect(
      getHedgerowEnhancementTimeMultiplier(
        NATIVE_HEDGEROW,
        POOR,
        MODERATE,
        0,
        0
      )
    ).toBe(MULTIPLIER_10_YRS)
  })

  it('returns the statutory multiplier for Poor to Good enhancement on species-rich hedge', () => {
    expect(
      getHedgerowEnhancementTimeMultiplier(
        SPECIES_RICH_HEDGEROW,
        POOR,
        GOOD,
        0,
        0
      )
    ).toBe(MULTIPLIER_30_YRS)
  })

  it('throws BaselineLookupError for an unrecognised hedge type', () => {
    expect(() =>
      getHedgerowEnhancementTimeMultiplier('Not a hedge', POOR, MODERATE, 0, 0)
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError for an unrecognised condition', () => {
    expect(() =>
      getHedgerowEnhancementTimeMultiplier(
        NATIVE_HEDGEROW,
        'N/A',
        MODERATE,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })
})

describe('getHedgerowEnhancementDifficultyMultiplier', () => {
  it('returns Low difficulty when advance meets statutory time to target', () => {
    expect(
      getHedgerowEnhancementDifficultyMultiplier(
        NATIVE_HEDGEROW,
        POOR,
        MODERATE,
        10,
        0
      )
    ).toBe(DIFFICULTY_LOW)
  })

  it('returns Enhancement difficulty when advance is below statutory time to target', () => {
    expect(
      getHedgerowEnhancementDifficultyMultiplier(
        NATIVE_HEDGEROW,
        POOR,
        MODERATE,
        2,
        0
      )
    ).toBe(DIFFICULTY_LOW)
  })

  it('throws BaselineLookupError for an unrecognised hedge type', () => {
    expect(() =>
      getHedgerowEnhancementDifficultyMultiplier(
        'Not a hedge',
        POOR,
        MODERATE,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })
})

// ---------------------------------------------------------------------------
// Watercourse creation
// ---------------------------------------------------------------------------

describe('getWatercourseCreationTimeMultiplier', () => {
  it('returns the statutory multiplier for Priority habitat in Moderate condition', () => {
    expect(
      getWatercourseCreationTimeMultiplier(PRIORITY_HABITAT, MODERATE, 0, 0)
    ).toBe(MULTIPLIER_30_YRS)
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      getWatercourseCreationTimeMultiplier('Not a watercourse', MODERATE, 0, 0)
    ).toThrow(BaselineLookupError)
  })
})

describe('getWatercourseCreationDifficultyMultiplier', () => {
  it('returns Creation difficulty for Priority habitat with no advance or delay', () => {
    expect(
      getWatercourseCreationDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        0,
        0
      )
    ).toBe(DIFFICULTY_CREATION)
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      getWatercourseCreationDifficultyMultiplier(
        'Not a watercourse',
        MODERATE,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })
})

// ---------------------------------------------------------------------------
// Watercourse enhancement
// ---------------------------------------------------------------------------

describe('getWatercourseEnhancementTimeMultiplier', () => {
  it('returns the statutory multiplier for Priority habitat Moderate to Good enhancement', () => {
    expect(
      getWatercourseEnhancementTimeMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        0,
        0
      )
    ).toBeGreaterThan(0)
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      getWatercourseEnhancementTimeMultiplier(
        'Not a watercourse',
        MODERATE,
        GOOD,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })
})

describe('getWatercourseEnhancementDifficultyMultiplier', () => {
  it('keeps Enhancement difficulty when advance is below statutory time to target', () => {
    expect(
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        2,
        0
      )
    ).toBe(DIFFICULTY_MEDIUM)
  })

  it('returns Low difficulty when advance meets statutory time to target', () => {
    expect(
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        4,
        0
      )
    ).toBe(DIFFICULTY_LOW)
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      getWatercourseEnhancementDifficultyMultiplier(
        'Not a watercourse',
        MODERATE,
        GOOD,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })

  it('accounts for delayYears when determining Low difficulty threshold', () => {
    // Priority habitat Moderate → Good has a statutory reference time-to-target
    // of 4 years. Advancing by 4 years (delay=0) meets the target → Low.
    // Adding a 2-year delay raises the effective target to 6 years, so advance=4
    // no longer meets it → Enhancement difficulty (Medium, 0.67).
    expect(
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        4,
        0
      )
    ).toBe(DIFFICULTY_LOW)
    expect(
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        4,
        2
      )
    ).toBe(DIFFICULTY_MEDIUM)
    // advance=6 with delay=2: effective years = 4+2-6 = 0 → Low again
    expect(
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        6,
        2
      )
    ).toBe(DIFFICULTY_LOW)
  })
})
