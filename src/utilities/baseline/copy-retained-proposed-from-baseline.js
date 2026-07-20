// When a post-intervention feature is Retained and the Proposed GPKG columns
// are empty, the UI still needs proposed.* identity fields. Copy them from
// baseline so status helpers and the frontend see the retained habitat.

import { isPresentEngineString } from './is-present-engine-string.js'
import { RETENTION_RETAINED } from './retention-category.js'

/** Proposed numeric zero is treated as empty (no user input). */
const EMPTY_NUMERIC_PROPOSED_VALUE = 0

/** Identity fields copied for area habitats (polygon parcels). */
export const RETAINED_AREA_PROPOSED_FIELDS = Object.freeze([
  'type',
  'broadType',
  'condition',
  'strategicSignificance'
])

/** Identity fields copied for hedgerows. */
export const RETAINED_HEDGEROW_PROPOSED_FIELDS = Object.freeze([
  'type',
  'condition'
])

/** Identity fields copied for watercourses. */
export const RETAINED_WATERCOURSE_PROPOSED_FIELDS = Object.freeze([
  'type',
  'condition',
  'riparianEncroachment',
  'watercourseEncroachment',
  'strategicSignificance'
])

/**
 * Identity fields copied for individual trees. Includes size/area so the
 * proposed side (and top-level area) match the retained baseline tree.
 */
export const RETAINED_TREE_PROPOSED_FIELDS = Object.freeze([
  'type',
  'broadType',
  'condition',
  'strategicSignificance',
  'treeSize',
  'treeSpecies',
  'ruralOrUrban',
  'sizeSquareMetres',
  'area'
])

/**
 * Tree emptiness check omits `broadType` — extract always sets it to
 * "Individual trees" even when Proposed columns are blank.
 */
export const RETAINED_TREE_EMPTINESS_FIELDS = Object.freeze([
  'treeSize',
  'ruralOrUrban',
  'condition',
  'treeSpecies',
  'strategicSignificance'
])

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isAbsentNumericProposedValue(value) {
  if (Number.isFinite(value)) {
    return value === EMPTY_NUMERIC_PROPOSED_VALUE
  }
  return true
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isAbsentProposedValue(value) {
  if (value === null || value === undefined || value === '') {
    return true
  }
  if (typeof value === 'number') {
    return isAbsentNumericProposedValue(value)
  }
  if (typeof value === 'string') {
    return isPresentEngineString(value) === false
  }
  return true
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPresentBaselineValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== EMPTY_NUMERIC_PROPOSED_VALUE
  }
  return isAbsentProposedValue(value) === false
}

/**
 * @param {object} proposed
 * @param {object} baseline
 * @param {readonly string[]} copyFields
 */
function copyBaselineIdentityOntoProposed(proposed, baseline, copyFields) {
  for (const field of copyFields) {
    if (
      isAbsentProposedValue(proposed[field]) &&
      isPresentBaselineValue(baseline[field])
    ) {
      proposed[field] = baseline[field]
    }
  }
}

/**
 * For Retained features with an empty proposed identity side, copy baseline
 * identity fields onto proposed. Mutates `feature.proposed` in place.
 * Does not touch advanceYears/delayYears or enrich-only score fields.
 *
 * @param {object} feature
 * @param {{ copyFields: readonly string[], emptinessFields?: readonly string[] }} options
 * @returns {object} the same feature (mutated)
 */
export function copyRetainedProposedFromBaseline(
  feature,
  { copyFields, emptinessFields = copyFields }
) {
  if (feature?.retentionCategory === RETENTION_RETAINED) {
    const baseline = feature.baseline
    const proposed = feature.proposed
    if (baseline && proposed) {
      const proposedSideEmpty = emptinessFields.every((field) =>
        isAbsentProposedValue(proposed[field])
      )
      if (proposedSideEmpty) {
        copyBaselineIdentityOntoProposed(proposed, baseline, copyFields)
      }
    }
  }
  return feature
}
