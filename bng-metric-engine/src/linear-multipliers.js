import { BaselineLookupError } from './errors.js'
import { CREATION, ENHANCEMENT } from './multipliers.js'
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
  DIFFICULTY_MULTIPLIER,
  TIME_TO_TARGET_MULTIPLIER
} from './reference-constants.js'
import {
  advanceMeetsTimeToTarget,
  applyDelayAdvanceAndClamp,
  normaliseReferenceYears,
  toTimeToTargetBucketKey
} from './linear-time-target-utils.js'
import { validateHabitatChange, validateYears } from './validate.js'

const NOT_POSSIBLE = 'Not Possible'
const LOW_DIFFICULTY = 'Low'

// ---------------------------------------------------------------------------
// Per-type config objects — injected into generic functions below
// ---------------------------------------------------------------------------

const HEDGEROW_CONFIG = {
  label: 'hedgerow',
  distinctivenessCategories: HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  conditionScores: HEDGEROW_CONDITION_SCORES,
  difficulty: HEDGEROW_DIFFICULTY,
  timeToTargetCreation: HEDGEROW_TIME_TO_TARGET_CREATION,
  timeToTargetEnhancement: HEDGEROW_TIME_TO_TARGET_ENHANCEMENT
}

const WATERCOURSE_CONFIG = {
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
function validateLinearType(linearType, distinctivenessCategories, label) {
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
function validateLinearCondition(
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
// Generic creation-path functions
// ---------------------------------------------------------------------------

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} endCondition
 * @returns {number | string}
 */
function lookupLinearCreationTimeToTarget(cfg, linearType, endCondition) {
  const value = cfg.timeToTargetCreation[linearType]?.[endCondition]
  if (value === undefined || value === null) {
    throw new BaselineLookupError(
      `Time to target not found for ${cfg.label}: ${linearType}, endCondition: ${endCondition}`
    )
  }
  if (value === NOT_POSSIBLE) {
    throw new BaselineLookupError(
      `Time to target '${NOT_POSSIBLE}' for ${cfg.label}: ${linearType}, endCondition: ${endCondition}`
    )
  }
  return value
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} endCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {string}
 */
function getLinearCreationTimeToTargetValue(
  cfg,
  linearType,
  endCondition,
  advanceYears,
  delayYears
) {
  validateLinearType(linearType, cfg.distinctivenessCategories, cfg.label)
  validateHabitatChange(CREATION)
  validateLinearCondition(
    linearType,
    endCondition,
    cfg.conditionScores,
    cfg.label
  )
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)

  const referenceYears = normaliseReferenceYears(
    lookupLinearCreationTimeToTarget(cfg, linearType, endCondition)
  )
  const computedYears = applyDelayAdvanceAndClamp(
    referenceYears,
    validatedAdvanceYears,
    validatedDelayYears
  )
  return toTimeToTargetBucketKey(computedYears)
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {number}
 */
function getLinearCreationTimeMultiplier(
  cfg,
  linearType,
  condition,
  advanceYears,
  delayYears
) {
  const timeToTargetKey = getLinearCreationTimeToTargetValue(
    cfg,
    linearType,
    condition,
    advanceYears,
    delayYears
  )
  const timeMultiplier = TIME_TO_TARGET_MULTIPLIER[timeToTargetKey]
  if (timeMultiplier === undefined || timeMultiplier === null) {
    throw new Error(
      `Time multiplier not found for ${cfg.label}: ${linearType}, condition: ${condition}`
    )
  }
  if (timeMultiplier === NOT_POSSIBLE) {
    throw new Error(
      `Time multiplier for ${cfg.label} '${linearType}' is not possible`
    )
  }
  return timeMultiplier
}

/**
 * Resolve the difficulty change type for a creation project, accounting for
 * the statutory rule that advance time meeting the "Poor" time-to-target
 * earns Enhancement difficulty bands.
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {number} validatedAdvanceYears
 * @param {number} validatedDelayYears
 * @param {string} timeToTargetKey
 * @returns {string} CREATION or ENHANCEMENT
 */
function resolveCreationDifficultyChangeType(
  cfg,
  linearType,
  validatedAdvanceYears,
  validatedDelayYears,
  timeToTargetKey
) {
  if (advanceMeetsTimeToTarget(validatedAdvanceYears, timeToTargetKey)) {
    return ENHANCEMENT
  }
  const poorTargetKey = getLinearCreationTimeToTargetValue(
    cfg,
    linearType,
    'Poor',
    validatedAdvanceYears,
    validatedDelayYears
  )
  return advanceMeetsTimeToTarget(validatedAdvanceYears, poorTargetKey)
    ? ENHANCEMENT
    : CREATION
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} difficultyChangeType
 * @returns {number}
 */
function lookupLinearDifficultyMultiplier(
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
  const multiplier = DIFFICULTY_MULTIPLIER[difficultyDesc]
  if (multiplier == null || multiplier === NOT_POSSIBLE) {
    throw new Error(
      `Difficulty multiplier not found for ${cfg.label}: ${linearType}, change type: ${difficultyChangeType}`
    )
  }
  return multiplier
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {number}
 */
function getLinearCreationDifficultyMultiplier(
  cfg,
  linearType,
  condition,
  advanceYears,
  delayYears
) {
  validateLinearType(linearType, cfg.distinctivenessCategories, cfg.label)
  validateHabitatChange(CREATION)
  validateLinearCondition(linearType, condition, cfg.conditionScores, cfg.label)
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)

  const timeToTargetKey = getLinearCreationTimeToTargetValue(
    cfg,
    linearType,
    condition,
    validatedAdvanceYears,
    validatedDelayYears
  )
  const difficultyChangeType = resolveCreationDifficultyChangeType(
    cfg,
    linearType,
    validatedAdvanceYears,
    validatedDelayYears,
    timeToTargetKey
  )
  return lookupLinearDifficultyMultiplier(cfg, linearType, difficultyChangeType)
}

// ---------------------------------------------------------------------------
// Generic enhancement-path functions
// ---------------------------------------------------------------------------

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} startCondition
 * @param {string} endCondition
 * @returns {number | string}
 */
function lookupLinearEnhancementTimeToTarget(
  cfg,
  linearType,
  startCondition,
  endCondition
) {
  const value =
    cfg.timeToTargetEnhancement[linearType]?.[startCondition]?.[endCondition]
  if (value === undefined || value === null) {
    throw new BaselineLookupError(
      `Time to target not found for ${cfg.label}: ${linearType}, startCondition: ${startCondition}, endCondition: ${endCondition}`
    )
  }
  if (value === NOT_POSSIBLE) {
    throw new BaselineLookupError(
      `Time to target '${NOT_POSSIBLE}' for ${cfg.label}: ${linearType}, startCondition: ${startCondition}, endCondition: ${endCondition}`
    )
  }
  return value
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} startCondition
 * @param {string} endCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {string}
 */
function getLinearEnhancementTimeToTargetValue(
  cfg,
  linearType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  validateLinearType(linearType, cfg.distinctivenessCategories, cfg.label)
  validateHabitatChange(ENHANCEMENT)
  validateLinearCondition(
    linearType,
    startCondition,
    cfg.conditionScores,
    cfg.label
  )
  validateLinearCondition(
    linearType,
    endCondition,
    cfg.conditionScores,
    cfg.label
  )
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)

  const referenceYears = normaliseReferenceYears(
    lookupLinearEnhancementTimeToTarget(
      cfg,
      linearType,
      startCondition,
      endCondition
    )
  )
  const computedYears = applyDelayAdvanceAndClamp(
    referenceYears,
    validatedAdvanceYears,
    validatedDelayYears
  )
  return toTimeToTargetBucketKey(computedYears)
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} startCondition
 * @param {string} endCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {number}
 */
function getLinearEnhancementTimeMultiplier(
  cfg,
  linearType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  const timeToTargetKey = getLinearEnhancementTimeToTargetValue(
    cfg,
    linearType,
    startCondition,
    endCondition,
    advanceYears,
    delayYears
  )
  const timeMultiplier = TIME_TO_TARGET_MULTIPLIER[timeToTargetKey]
  if (timeMultiplier === undefined || timeMultiplier === null) {
    throw new Error(
      `Time multiplier not found for ${cfg.label}: ${linearType}, startCondition: ${startCondition}, endCondition: ${endCondition}`
    )
  }
  if (timeMultiplier === NOT_POSSIBLE) {
    throw new Error(
      `Time multiplier for ${cfg.label} '${linearType}' is not possible`
    )
  }
  return timeMultiplier
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} startCondition
 * @param {string} endCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {number}
 */
function getLinearEnhancementDifficultyMultiplier(
  cfg,
  linearType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  validateLinearType(linearType, cfg.distinctivenessCategories, cfg.label)
  validateHabitatChange(ENHANCEMENT)
  validateLinearCondition(
    linearType,
    startCondition,
    cfg.conditionScores,
    cfg.label
  )
  validateLinearCondition(
    linearType,
    endCondition,
    cfg.conditionScores,
    cfg.label
  )
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)

  const referenceYears = normaliseReferenceYears(
    lookupLinearEnhancementTimeToTarget(
      cfg,
      linearType,
      startCondition,
      endCondition
    )
  )

  // Delay lengthens the effective time to target; advance must compensate for both.
  const computedYears = applyDelayAdvanceAndClamp(
    referenceYears,
    validatedAdvanceYears,
    validatedDelayYears
  )
  if (computedYears === 0) {
    return DIFFICULTY_MULTIPLIER[LOW_DIFFICULTY]
  }
  return lookupLinearDifficultyMultiplier(cfg, linearType, ENHANCEMENT)
}

export {
  HEDGEROW_CONFIG,
  WATERCOURSE_CONFIG,
  getLinearCreationTimeMultiplier,
  getLinearCreationDifficultyMultiplier,
  getLinearEnhancementTimeMultiplier,
  getLinearEnhancementDifficultyMultiplier
}
