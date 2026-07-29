import { BaselineLookupError } from './errors.js'
import { CREATION, ENHANCEMENT } from './multipliers.js'
import { TIME_TO_TARGET_MULTIPLIER } from './reference-constants.js'
import {
  advanceMeetsTimeToTarget,
  applyDelayAdvanceAndClamp,
  normaliseReferenceYears,
  toTimeToTargetBucketKey
} from './linear-time-target-utils.js'
import {
  validateAdvanceAndDelayYears,
  validateHabitatChange
} from './validate.js'
import {
  lookupLinearDifficultyLabel,
  multiplierForDifficultyLabel,
  NOT_POSSIBLE,
  validateLinearCondition,
  validateLinearType
} from './linear-multiplier-shared.js'

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
export function getLinearCreationTimeToTargetValue(
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
  const { validatedAdvanceYears, validatedDelayYears } =
    validateAdvanceAndDelayYears(advanceYears, delayYears)

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
export function getLinearCreationTimeMultiplier(
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
 * Resolve the difficulty band label used for a Creation-path linear feature
 * (including the advance-meets-Poor-target reclassification to Enhancement
 * bands). Shared by the label and multiplier accessors so display and unit
 * calculation can never disagree.
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {string}
 */
export function getLinearCreationDifficultyLabel(
  cfg,
  linearType,
  condition,
  advanceYears,
  delayYears
) {
  validateLinearType(linearType, cfg.distinctivenessCategories, cfg.label)
  validateHabitatChange(CREATION)
  validateLinearCondition(linearType, condition, cfg.conditionScores, cfg.label)
  const { validatedAdvanceYears, validatedDelayYears } =
    validateAdvanceAndDelayYears(advanceYears, delayYears)

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
  return lookupLinearDifficultyLabel(cfg, linearType, difficultyChangeType)
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {number}
 */
export function getLinearCreationDifficultyMultiplier(
  cfg,
  linearType,
  condition,
  advanceYears,
  delayYears
) {
  const difficultyLabel = getLinearCreationDifficultyLabel(
    cfg,
    linearType,
    condition,
    advanceYears,
    delayYears
  )
  return multiplierForDifficultyLabel(cfg, linearType, difficultyLabel)
}
