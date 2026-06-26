import {
  HEDGEROW_CONFIG,
  getLinearCreationDifficultyMultiplier,
  getLinearCreationTimeMultiplier,
  getLinearEnhancementDifficultyMultiplier,
  getLinearEnhancementTimeMultiplier
} from './linear-multipliers.js'

/** @param {string} hedgeType @param {string} condition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getHedgerowCreationTimeMultiplier(
  hedgeType,
  condition,
  advanceYears,
  delayYears
) {
  return getLinearCreationTimeMultiplier(
    HEDGEROW_CONFIG,
    hedgeType,
    condition,
    advanceYears,
    delayYears
  )
}

/** @param {string} hedgeType @param {string} condition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getHedgerowCreationDifficultyMultiplier(
  hedgeType,
  condition,
  advanceYears,
  delayYears
) {
  return getLinearCreationDifficultyMultiplier(
    HEDGEROW_CONFIG,
    hedgeType,
    condition,
    advanceYears,
    delayYears
  )
}

/** @param {string} hedgeType @param {string} startCondition @param {string} endCondition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getHedgerowEnhancementTimeMultiplier(
  hedgeType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  return getLinearEnhancementTimeMultiplier(
    HEDGEROW_CONFIG,
    hedgeType,
    startCondition,
    endCondition,
    advanceYears,
    delayYears
  )
}

/** @param {string} hedgeType @param {string} startCondition @param {string} endCondition @param {number} advanceYears @param {number} delayYears @returns {number} */
export function getHedgerowEnhancementDifficultyMultiplier(
  hedgeType,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  return getLinearEnhancementDifficultyMultiplier(
    HEDGEROW_CONFIG,
    hedgeType,
    startCondition,
    endCondition,
    advanceYears,
    delayYears
  )
}
