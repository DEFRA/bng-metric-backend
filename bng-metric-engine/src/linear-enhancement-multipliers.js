import { BaselineLookupError } from './errors.js'
import { ENHANCEMENT } from './multipliers.js'
import { TIME_TO_TARGET_MULTIPLIER } from './reference-constants.js'
import {
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
  LOW_DIFFICULTY,
  multiplierForDifficultyLabel,
  NOT_POSSIBLE,
  validateLinearCondition,
  validateLinearType
} from './linear-multiplier-shared.js'

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
export function getLinearEnhancementTimeToTargetValue(
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
  const { validatedAdvanceYears, validatedDelayYears } =
    validateAdvanceAndDelayYears(advanceYears, delayYears)

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
export function getLinearEnhancementTimeMultiplier(
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
 * @returns {string}
 */
export function getLinearEnhancementDifficultyLabel(
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
  const { validatedAdvanceYears, validatedDelayYears } =
    validateAdvanceAndDelayYears(advanceYears, delayYears)

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
    return LOW_DIFFICULTY
  }
  return lookupLinearDifficultyLabel(cfg, linearType, ENHANCEMENT)
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
export function getLinearEnhancementDifficultyMultiplier(
  cfg,
  linearType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  const difficultyLabel = getLinearEnhancementDifficultyLabel(
    cfg,
    linearType,
    startCondition,
    endCondition,
    advanceYears,
    delayYears
  )
  return multiplierForDifficultyLabel(cfg, linearType, difficultyLabel)
}
