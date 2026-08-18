import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { ERROR_LIST_SAMPLE_CAP } from '../postgis/constants.js'
import {
  stagedBaselineDriftedWarning,
  stagedFeaturesRemovedWarning,
  stagedParentInferredWarning,
  stagedMissingBaselineLayerError,
  stagedParentOversubscribedError,
  stagedPiOutsideParentError,
  stagedSizeMismatchError,
  stagedUnknownParentRefError,
  typeLabel
} from './error-builders.js'
import { HABITAT_TYPES } from './staged-layer-names.js'

const OVER_CAP = ERROR_LIST_SAMPLE_CAP + 5

describe('typeLabel', () => {
  it('translates internal keys into words a surveyor uses', () => {
    expect(typeLabel(HABITAT_TYPES.VERTICAL_AREAS)).toBe(
      'vertical area habitats'
    )
  })

  it('falls back to the raw key rather than dropping it', () => {
    expect(typeLabel('somethingNew')).toBe('somethingNew')
  })
})

describe('stagedMissingBaselineLayerError', () => {
  it('names every layer that has no baseline counterpart', () => {
    const error = stagedMissingBaselineLayerError([
      HABITAT_TYPES.HEDGEROWS,
      HABITAT_TYPES.TREES
    ])

    expect(error.code).toBe(ERROR_CODES.STAGED_MISSING_BASELINE_LAYER)
    expect(error.message).toBe(
      'Post-intervention layers have no matching baseline layer: hedgerows, trees'
    )
    expect(error.details.count).toBe(2)
  })
})

describe('stagedUnknownParentRefError', () => {
  it('names the feature and the parent it points at', () => {
    const error = stagedUnknownParentRefError([
      { type: HABITAT_TYPES.AREAS, pi_ref: 'PR-1a', parent_ref: 'GONE' }
    ])

    expect(error.code).toBe(ERROR_CODES.STAGED_UNKNOWN_PARENT_REF)
    expect(error.message).toContain('area habitats PR-1a → "GONE"')
  })

  it('still reads sensibly when the feature has no PI Ref', () => {
    const error = stagedUnknownParentRefError([
      { type: HABITAT_TYPES.TREES, pi_ref: null, parent_ref: 'T-9' }
    ])

    expect(error.message).toContain('trees feature → "T-9"')
  })

  it('caps the sample but keeps the count truthful', () => {
    const samples = Array.from({ length: OVER_CAP }, (_unused, i) => ({
      type: HABITAT_TYPES.AREAS,
      pi_ref: `PR-${i}`,
      parent_ref: 'GONE'
    }))

    const error = stagedUnknownParentRefError(samples)

    expect(error.details.count).toBe(OVER_CAP)
    expect(error.details.sample).toHaveLength(ERROR_LIST_SAMPLE_CAP)
    expect(error.message).toContain(
      `(and ${OVER_CAP - ERROR_LIST_SAMPLE_CAP} more)`
    )
  })
})

describe('stagedPiOutsideParentError', () => {
  it('quotes the escaping size in the type’s own unit', () => {
    const error = stagedPiOutsideParentError([
      {
        type: HABITAT_TYPES.AREAS,
        pi_ref: 'PR-1',
        parent_ref: 'PR-2',
        escape_size: 12.345,
        measure: 'area'
      },
      {
        type: HABITAT_TYPES.HEDGEROWS,
        pi_ref: 'HR-1a',
        parent_ref: 'HR-1',
        escape_size: 3,
        measure: 'length'
      }
    ])

    expect(error.code).toBe(ERROR_CODES.STAGED_PI_OUTSIDE_PARENT)
    expect(error.message).toContain(
      'area habitats PR-1 escapes "PR-2" by ~12.35 sq m'
    )
    expect(error.message).toContain('hedgerows HR-1a escapes "HR-1" by ~3.00 m')
  })
})

describe('stagedSizeMismatchError', () => {
  it('shows both totals so the gap is visible', () => {
    const error = stagedSizeMismatchError([
      {
        type: HABITAT_TYPES.HEDGEROWS,
        measure: 'length',
        baseline_total: 200,
        pi_total: 100,
        delta: 100
      }
    ])

    expect(error.code).toBe(ERROR_CODES.STAGED_SIZE_MISMATCH)
    expect(error.message).toBe(
      'Baseline and post-intervention totals do not match: hedgerows — baseline 200.00 m vs post-intervention 100.00 m'
    )
    expect(error.details.sample[0].delta).toBe(100)
  })
})

describe('stagedParentOversubscribedError', () => {
  it('quotes children total against the baseline in the type’s unit', () => {
    const error = stagedParentOversubscribedError([
      {
        type: HABITAT_TYPES.HEDGEROWS,
        parent_ref: 'HR-1',
        measure: 'length',
        baseline_size: 200,
        pi_size: 300,
        excess: 100
      }
    ])

    expect(error.code).toBe(ERROR_CODES.STAGED_PARENT_OVERSUBSCRIBED)
    expect(error.message).toContain(
      'hedgerows "HR-1" — children total 300.00 m against a baseline of 200.00 m'
    )
  })
})

describe('stagedFeaturesRemovedWarning', () => {
  it('quotes the removed length with decimals', () => {
    const warning = stagedFeaturesRemovedWarning([
      {
        type: HABITAT_TYPES.HEDGEROWS,
        parent_ref: 'HR-1',
        measure: 'length',
        baseline_size: 200,
        pi_size: 100,
        removed_size: 100
      }
    ])

    expect(warning.code).toBe(ERROR_CODES.STAGED_FEATURES_REMOVED)
    expect(warning.message).toContain(
      'hedgerows "HR-1" — 100.00 m with no post-intervention continuation'
    )
  })

  it('quotes tree counts as whole trees, not decimals', () => {
    const warning = stagedFeaturesRemovedWarning([
      {
        type: HABITAT_TYPES.TREES,
        parent_ref: 'T-2',
        measure: 'count',
        baseline_size: 1,
        pi_size: 0,
        removed_size: 1
      }
    ])

    expect(warning.message).toContain(
      'trees "T-2" — 1 with no post-intervention continuation'
    )
    expect(warning.message).not.toContain('1.00')
  })
})

describe('stagedBaselineDriftedWarning', () => {
  it('names the parent and how many rows were copied from the old shape', () => {
    const warning = stagedBaselineDriftedWarning([
      { type: HABITAT_TYPES.WATERCOURSES, parent_ref: 'WC-1', pi_count: 3 }
    ])

    expect(warning.code).toBe(ERROR_CODES.STAGED_BASELINE_DRIFTED)
    expect(warning.message).toContain(
      'watercourses "WC-1" — 3 post-intervention row(s) were copied from an older shape'
    )
  })
})

describe('stagedParentInferredWarning', () => {
  it('names the inferred parent', () => {
    const warning = stagedParentInferredWarning([
      { type: HABITAT_TYPES.HEDGEROWS, pi_ref: 'HR-1a', parent_ref: 'HR-1' }
    ])

    expect(warning.code).toBe(ERROR_CODES.STAGED_PARENT_INFERRED)
    expect(warning.message).toContain(
      'hedgerows HR-1a → "HR-1" (inferred from overlap)'
    )
  })

  it('says so when even geometry found nothing', () => {
    const warning = stagedParentInferredWarning([
      { type: HABITAT_TYPES.TREES, pi_ref: 'T-9', parent_ref: null }
    ])

    expect(warning.message).toContain('trees T-9 → no baseline overlap found')
  })
})
