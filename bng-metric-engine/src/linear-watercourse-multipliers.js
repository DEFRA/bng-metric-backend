import {
  WATERCOURSE_CONFIG,
  getLinearCreationDifficultyLabel,
  getLinearCreationDifficultyMultiplier,
  getLinearCreationTimeMultiplier,
  getLinearCreationTimeToTargetValue,
  getLinearEnhancementDifficultyMultiplier,
  getLinearEnhancementTimeMultiplier
} from './linear-multipliers.js'

/** @param {string} watercourseType @param {string} condition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getWatercourseCreationTimeMultiplier(
  watercourseType,
  condition,
  advanceYears,
  delayYears
) {
  return getLinearCreationTimeMultiplier(
    WATERCOURSE_CONFIG,
    watercourseType,
    condition,
    advanceYears,
    delayYears
  )
}

/** @param {string} watercourseType @param {string} condition @param {number} advanceYears @param {number} delayYears @returns {string} Time-to-target bucket key (e.g. "5", ">30") */
export function getWatercourseCreationTimeToTargetValue(
  watercourseType,
  condition,
  advanceYears,
  delayYears
) {
  return getLinearCreationTimeToTargetValue(
    WATERCOURSE_CONFIG,
    watercourseType,
    condition,
    advanceYears,
    delayYears
  )
}

/** @param {string} watercourseType @param {string} condition @param {number} advanceYears @param {number} delayYears @returns {string} Difficulty band label (e.g. "Low", "Medium", "High") */
export function getWatercourseCreationDifficultyLabel(
  watercourseType,
  condition,
  advanceYears,
  delayYears
) {
  return getLinearCreationDifficultyLabel(
    WATERCOURSE_CONFIG,
    watercourseType,
    condition,
    advanceYears,
    delayYears
  )
}

/** @param {string} watercourseType @param {string} condition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getWatercourseCreationDifficultyMultiplier(
  watercourseType,
  condition,
  advanceYears,
  delayYears
) {
  return getLinearCreationDifficultyMultiplier(
    WATERCOURSE_CONFIG,
    watercourseType,
    condition,
    advanceYears,
    delayYears
  )
}

/** @param {string} watercourseType @param {string} startCondition @param {string} endCondition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getWatercourseEnhancementTimeMultiplier(
  watercourseType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  return getLinearEnhancementTimeMultiplier(
    WATERCOURSE_CONFIG,
    watercourseType,
    startCondition,
    endCondition,
    advanceYears,
    delayYears
  )
}

/** @param {string} watercourseType @param {string} startCondition @param {string} endCondition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getWatercourseEnhancementDifficultyMultiplier(
  watercourseType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  return getLinearEnhancementDifficultyMultiplier(
    WATERCOURSE_CONFIG,
    watercourseType,
    startCondition,
    endCondition,
    advanceYears,
    delayYears
  )
}
