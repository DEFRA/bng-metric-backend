import { BaselineLookupError } from './errors.js'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DIFFICULTY,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_TIME_TO_TARGET_CREATION,
  HEDGEROW_TIME_TO_TARGET_ENHANCEMENT,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DIFFICULTY,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_TIME_TO_TARGET_CREATION,
  WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT,
  DIFFICULTY_MULTIPLIER
} from './reference-constants.js'

export const NOT_POSSIBLE = 'Not Possible'
export const LOW_DIFFICULTY = 'Low'

// ---------------------------------------------------------------------------
// Per-type config objects — injected into generic functions
// ---------------------------------------------------------------------------

export const HEDGEROW_CONFIG = {
  label: 'hedgerow',
  distinctivenessCategories: HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  conditionScores: HEDGEROW_CONDITION_SCORES,
  difficulty: HEDGEROW_DIFFICULTY,
  timeToTargetCreation: HEDGEROW_TIME_TO_TARGET_CREATION,
  timeToTargetEnhancement: HEDGEROW_TIME_TO_TARGET_ENHANCEMENT
}

export const WATERCOURSE_CONFIG = {
  label: 'watercourse',
  distinctivenessCategories: WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  conditionScores: WATERCOURSE_CONDITION_SCORES,
  difficulty: WATERCOURSE_DIFFICULTY,
  timeToTargetCreation: WATERCOURSE_TIME_TO_TARGET_CREATION,
  timeToTargetEnhancement: WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT
}

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} linearType
 * @param {Record<string, string>} distinctivenessCategories
 * @param {string} label
 */
export function validateLinearType(
  linearType,
  distinctivenessCategories,
  label
) {
  if (linearType === null || linearType === undefined || linearType === '') {
    throw new BaselineLookupError(`${label} type must be a non-empty string`)
  }
  if (typeof linearType !== 'string') {
    throw new TypeError(
      `${label} type must be a string, got ${typeof linearType}`
    )
  }
  if (!Object.hasOwn(distinctivenessCategories, linearType)) {
    throw new BaselineLookupError(
      `${label} '${linearType}' is not a valid ${label} type`
    )
  }
}

/**
 * @param {string} linearType
 * @param {string} condition
 * @param {Record<string, Record<string, number | string>>} conditionScores
 * @param {string} label
 */
export function validateLinearCondition(
  linearType,
  condition,
  conditionScores,
  label
) {
  if (condition === null || condition === undefined || condition === '') {
    throw new BaselineLookupError(
      `${label} condition must be a non-empty string`
    )
  }
  if (typeof condition !== 'string') {
    throw new TypeError(
      `${label} condition must be a string, got ${typeof condition}`
    )
  }
  const row = conditionScores[linearType]
  if (!row || typeof row !== 'object') {
    throw new BaselineLookupError(
      `Condition scores not found for ${label} type: ${linearType}`
    )
  }
  if (!Object.hasOwn(row, condition)) {
    throw new BaselineLookupError(
      `Condition '${condition}' is not a valid condition for ${label}: ${linearType}`
    )
  }
}

// ---------------------------------------------------------------------------
// Shared difficulty helpers
// ---------------------------------------------------------------------------

/**
 * Difficulty band label from the type's difficulty reference data (e.g.
 * watercourse-difficulty.json / hedgerow-difficulty.json).
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} difficultyChangeType
 * @returns {string}
 */
export function lookupLinearDifficultyLabel(
  cfg,
  linearType,
  difficultyChangeType
) {
  const difficultyRow = cfg.difficulty[linearType]
  if (!difficultyRow || typeof difficultyRow !== 'object') {
    throw new Error(
      `No difficulty reference data for ${cfg.label}: ${linearType}`
    )
  }
  const difficultyDesc = difficultyRow[difficultyChangeType]
  if (!difficultyDesc) {
    throw new Error(
      `Difficulty not found for ${cfg.label}: ${linearType}, change type: ${difficultyChangeType}`
    )
  }
  return difficultyDesc
}

/**
 * Shared by the Creation and Enhancement difficulty-multiplier accessors so
 * the "label not found" error handling only exists in one place.
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} difficultyLabel
 * @returns {number}
 */
export function multiplierForDifficultyLabel(cfg, linearType, difficultyLabel) {
  const multiplier = DIFFICULTY_MULTIPLIER[difficultyLabel]
  if (multiplier == null || multiplier === NOT_POSSIBLE) {
    throw new Error(
      `Difficulty multiplier not found for ${cfg.label}: ${linearType}`
    )
  }
  return multiplier
}
