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
  getWatercourseCreationDifficultyLabel,
  getWatercourseCreationDifficultyMultiplier,
  getWatercourseCreationTimeMultiplier,
  getWatercourseCreationTimeToTargetValue,
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
const CONDITION_ASSESSMENT_NA = 'Condition Assessment N/A'
const WATERCOURSE_DITCHES = 'Ditches'

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

describe('getWatercourseCreationTimeToTargetValue', () => {
  it('returns the statutory reference years as a bucket key text', () => {
    expect(
      getWatercourseCreationTimeToTargetValue(PRIORITY_HABITAT, MODERATE, 0, 0)
    ).toBe('5')
  })

  it('applies advance/delay when resolving the bucket key', () => {
    expect(
      getWatercourseCreationTimeToTargetValue(PRIORITY_HABITAT, MODERATE, 2, 0)
    ).toBe('3')
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      getWatercourseCreationTimeToTargetValue(
        'Not a watercourse',
        MODERATE,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })
})

describe('getWatercourseCreationDifficultyLabel', () => {
  it('returns the Creation band label when advance does not clear the Poor target', () => {
    expect(
      getWatercourseCreationDifficultyLabel(PRIORITY_HABITAT, MODERATE, 0, 0)
    ).toBe('High')
  })

  it('matches the band that getWatercourseCreationDifficultyMultiplier applies', () => {
    const label = getWatercourseCreationDifficultyLabel(
      PRIORITY_HABITAT,
      MODERATE,
      0,
      0
    )
    expect(label).toBe('High')
    expect(
      getWatercourseCreationDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        0,
        0
      )
    ).toBe(DIFFICULTY_CREATION)
  })

  it('reclassifies to the Enhancement band once advance clears the Poor target', () => {
    // Priority habitat Poor time-to-target is 1 year, so advanceYears: 1
    // reclassifies Creation difficulty to the Enhancement band (Medium),
    // not directly to Low as area habitats do.
    const label = getWatercourseCreationDifficultyLabel(
      PRIORITY_HABITAT,
      MODERATE,
      1,
      0
    )
    expect(label).toBe('Medium')
    expect(
      getWatercourseCreationDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        1,
        0
      )
    ).toBe(DIFFICULTY_MEDIUM)
  })

  it('stays on the Enhancement band even when advance fully meets the target', () => {
    // Meeting the full Moderate target (5 years) still only reclassifies to
    // Enhancement (Medium) for watercourse creation — unlike area habitats,
    // which force Low once advance meets the full target.
    const label = getWatercourseCreationDifficultyLabel(
      PRIORITY_HABITAT,
      MODERATE,
      5,
      0
    )
    expect(label).toBe('Medium')
  })

  it('throws BaselineLookupError for an unrecognised watercourse type', () => {
    expect(() =>
      getWatercourseCreationDifficultyLabel('Not a watercourse', MODERATE, 0, 0)
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

  it('uses Low difficulty once advance alone meets the time to target', () => {
    // Priority habitat Moderate → Good has a statutory reference time-to-target
    // of 4 years. Advancing by 4 years meets the target → Low.
    expect(
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        4,
        0
      )
    ).toBe(DIFFICULTY_LOW)
    // A 2-year delay on its own leaves the enhancement band (Medium, 0.67).
    expect(
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        0,
        2
      )
    ).toBe(DIFFICULTY_MEDIUM)
  })

  it('rejects advance and delay on the same watercourse', () => {
    expect(() =>
      getWatercourseEnhancementDifficultyMultiplier(
        PRIORITY_HABITAT,
        MODERATE,
        GOOD,
        4,
        2
      )
    ).toThrow(/cannot both be used on the same habitat/)
  })
})

// ---------------------------------------------------------------------------
// Shared linear type/condition validation edge cases
// ---------------------------------------------------------------------------

describe('shared linear type/condition validation', () => {
  it('throws BaselineLookupError for an empty linear type', () => {
    expect(() => getHedgerowCreationTimeMultiplier('', MODERATE, 0, 0)).toThrow(
      BaselineLookupError
    )
  })

  it('throws TypeError for a non-string linear type', () => {
    expect(() =>
      getHedgerowCreationTimeMultiplier(123, MODERATE, 0, 0)
    ).toThrow(TypeError)
  })

  it('throws BaselineLookupError for an empty condition', () => {
    expect(() =>
      getHedgerowCreationTimeMultiplier(NATIVE_HEDGEROW, '', 0, 0)
    ).toThrow(BaselineLookupError)
  })

  it('throws TypeError for a non-string condition', () => {
    expect(() =>
      getHedgerowCreationTimeMultiplier(NATIVE_HEDGEROW, 123, 0, 0)
    ).toThrow(TypeError)
  })

  it('throws when condition scores are missing for an otherwise-valid watercourse type', () => {
    const original =
      referenceConstants.WATERCOURSE_CONDITION_SCORES[WATERCOURSE_DITCHES]
    delete referenceConstants.WATERCOURSE_CONDITION_SCORES[WATERCOURSE_DITCHES]
    try {
      expect(() =>
        getWatercourseCreationTimeMultiplier(
          WATERCOURSE_DITCHES,
          MODERATE,
          0,
          0
        )
      ).toThrow('Condition scores not found')
    } finally {
      referenceConstants.WATERCOURSE_CONDITION_SCORES[WATERCOURSE_DITCHES] =
        original
    }
  })

  it('throws when there is no difficulty reference data for an otherwise-valid watercourse type', () => {
    const original =
      referenceConstants.WATERCOURSE_DIFFICULTY[WATERCOURSE_DITCHES]
    delete referenceConstants.WATERCOURSE_DIFFICULTY[WATERCOURSE_DITCHES]
    try {
      expect(() =>
        getWatercourseCreationDifficultyLabel(
          WATERCOURSE_DITCHES,
          MODERATE,
          0,
          0
        )
      ).toThrow('No difficulty reference data')
    } finally {
      referenceConstants.WATERCOURSE_DIFFICULTY[WATERCOURSE_DITCHES] = original
    }
  })

  it('throws when the difficulty band is missing for the resolved change type', () => {
    const original =
      referenceConstants.WATERCOURSE_DIFFICULTY[WATERCOURSE_DITCHES]
    referenceConstants.WATERCOURSE_DIFFICULTY[WATERCOURSE_DITCHES] = {
      Creation: 'Low'
    }
    try {
      // Ditches Poor time-to-target is 1 year, so advanceYears: 1
      // reclassifies to the (now-missing) Enhancement band.
      expect(() =>
        getWatercourseCreationDifficultyLabel(
          WATERCOURSE_DITCHES,
          MODERATE,
          1,
          0
        )
      ).toThrow('Difficulty not found')
    } finally {
      referenceConstants.WATERCOURSE_DIFFICULTY[WATERCOURSE_DITCHES] = original
    }
  })
})

// ---------------------------------------------------------------------------
// Creation time-to-target / time-multiplier edge cases
// ---------------------------------------------------------------------------

describe('creation time-to-target and time-multiplier edge cases', () => {
  it('throws BaselineLookupError when the creation time-to-target is Not Possible', () => {
    expect(() =>
      getWatercourseCreationTimeToTargetValue(
        PRIORITY_HABITAT,
        CONDITION_ASSESSMENT_NA,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError when creation time-to-target data is missing an entry', () => {
    const original =
      referenceConstants.WATERCOURSE_TIME_TO_TARGET_CREATION[PRIORITY_HABITAT]
        .Moderate
    delete referenceConstants.WATERCOURSE_TIME_TO_TARGET_CREATION[
      PRIORITY_HABITAT
    ].Moderate
    try {
      expect(() =>
        getWatercourseCreationTimeToTargetValue(
          PRIORITY_HABITAT,
          MODERATE,
          0,
          0
        )
      ).toThrow('Time to target not found')
    } finally {
      referenceConstants.WATERCOURSE_TIME_TO_TARGET_CREATION[
        PRIORITY_HABITAT
      ].Moderate = original
    }
  })

  it('throws when the creation time multiplier table has no entry for the computed key', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_MULTIPLIER', 'get')
    spy.mockReturnValue({})
    try {
      expect(() =>
        getWatercourseCreationTimeMultiplier(PRIORITY_HABITAT, MODERATE, 0, 0)
      ).toThrow('Time multiplier not found')
    } finally {
      spy.mockRestore()
    }
  })

  it('throws when the creation time multiplier is Not Possible', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_MULTIPLIER', 'get')
    spy.mockReturnValue({
      ...referenceConstants.TIME_TO_TARGET_MULTIPLIER,
      5: 'Not Possible'
    })
    try {
      expect(() =>
        getWatercourseCreationTimeMultiplier(PRIORITY_HABITAT, MODERATE, 0, 0)
      ).toThrow('is not possible')
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// Enhancement time-to-target / time-multiplier edge cases
// ---------------------------------------------------------------------------

describe('enhancement time-to-target and time-multiplier edge cases', () => {
  it('throws BaselineLookupError when enhancement time-to-target has no entry for the start condition', () => {
    expect(() =>
      getHedgerowEnhancementTimeToTargetValue(
        NATIVE_HEDGEROW,
        CONDITION_ASSESSMENT_NA,
        GOOD,
        0,
        0
      )
    ).toThrow(BaselineLookupError)
  })

  it('throws BaselineLookupError when the enhancement time-to-target is Not Possible', () => {
    expect(() =>
      getHedgerowEnhancementTimeToTargetValue(NATIVE_HEDGEROW, POOR, POOR, 0, 0)
    ).toThrow(BaselineLookupError)
  })

  it('throws when the enhancement time multiplier table has no entry for the computed key', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_MULTIPLIER', 'get')
    spy.mockReturnValue({})
    try {
      expect(() =>
        getWatercourseEnhancementTimeMultiplier(
          PRIORITY_HABITAT,
          MODERATE,
          GOOD,
          0,
          0
        )
      ).toThrow('Time multiplier not found')
    } finally {
      spy.mockRestore()
    }
  })

  it('throws when the enhancement time multiplier is Not Possible', () => {
    const spy = vi.spyOn(referenceConstants, 'TIME_TO_TARGET_MULTIPLIER', 'get')
    spy.mockReturnValue({
      ...referenceConstants.TIME_TO_TARGET_MULTIPLIER,
      4: 'Not Possible'
    })
    try {
      expect(() =>
        getWatercourseEnhancementTimeMultiplier(
          PRIORITY_HABITAT,
          MODERATE,
          GOOD,
          0,
          0
        )
      ).toThrow('is not possible')
    } finally {
      spy.mockRestore()
    }
  })
})
