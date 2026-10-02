import {
  MAX_YEARS,
  MAX_YEARS_PLUS,
  MIN_YEARS,
  OVER_MAX_YEARS
} from 'bng-library/metric'

/**
 * Shared display-field helpers for post-intervention `proposed` time/difficulty
 * labels. Used by area, hedgerow and watercourse enrichment (any retention
 * category that goes through `applyProposedResult`).
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function finiteYearsOrZero(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return 0
}

/**
 * Parse statutory standard time-to-target text (e.g. "10") to a number of years.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function parseStandardYears(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

/**
 * Advance/delay summary for the UI.
 * Prefer advance when advanceYears > delayYears; delay when the reverse;
 * otherwise "Neither".
 *
 * @param {unknown} advanceYears
 * @param {unknown} delayYears
 * @returns {string}
 */
export function resolveAdvanceOrDelay(advanceYears, delayYears) {
  const advance = finiteYearsOrZero(advanceYears)
  const delay = finiteYearsOrZero(delayYears)
  if (advance > delay) {
    return `Advance - ${advance - delay} years`
  }
  if (delay > advance) {
    return `Delay - ${delay - advance} years`
  }
  return 'Neither'
}

/**
 * Final years as the metric words them, using the same rule bng-library/metric
 * applies before choosing timeMultiplier (metric tabs A-2 column S, A-3 column
 * AH, B-2 column Q), so the displayed years never contradict the multiplier
 * shown alongside them:
 * - a "30+" standard with no advance stays "30+";
 * - with an advance it counts down from 30, never below MIN_YEARS;
 * - anything a delay pushes past MAX_YEARS is "30+".
 *
 * @param {number} standardYears - 30 for a "30+" standard
 * @param {boolean} isOverMaxStandard - true when the standard is "30+"
 * @param {number} advance
 * @param {number} delay
 * @returns {number | string}
 */
function resolveFinalYears(standardYears, isOverMaxStandard, advance, delay) {
  const finalYears = standardYears - advance + delay
  if ((isOverMaxStandard && advance === 0) || finalYears > MAX_YEARS) {
    return MAX_YEARS_PLUS
  }
  return Math.max(finalYears, MIN_YEARS)
}

/**
 * Final time-to-target display for the UI.
 * Format: "{standard - advance + delay} years (timeMultiplier)", worded as
 * "30+ years" where the metric uses its "30+" multiplier.
 *
 * @param {{
 *   standardTimeToTargetCondition: unknown,
 *   advanceYears: unknown,
 *   delayYears: unknown,
 *   timeMultiplier: unknown
 * }} input
 * @returns {string | null}
 */
export function resolveFinalTimeToTargetCondition({
  standardTimeToTargetCondition,
  advanceYears,
  delayYears,
  timeMultiplier
}) {
  const isOverMaxStandard = standardTimeToTargetCondition === OVER_MAX_YEARS
  const standardYears = isOverMaxStandard
    ? MAX_YEARS
    : parseStandardYears(standardTimeToTargetCondition)
  const hasValidTimeMultiplier =
    typeof timeMultiplier === 'number' && Number.isFinite(timeMultiplier)
  if (standardYears === null || !hasValidTimeMultiplier) {
    return null
  }
  const finalYears = resolveFinalYears(
    standardYears,
    isOverMaxStandard,
    finiteYearsOrZero(advanceYears),
    finiteYearsOrZero(delayYears)
  )
  return `${finalYears} years (${timeMultiplier})`
}

/**
 * Write `advanceOrDelay` and (when inputs allow) `finalTimeToTargetCondition`
 * onto a proposed sub-object.
 *
 * @param {object} proposed
 */
export function applyProposedTimeDifficultyDisplayFields(proposed) {
  proposed.advanceOrDelay = resolveAdvanceOrDelay(
    proposed.advanceYears,
    proposed.delayYears
  )
  const finalTimeToTargetCondition = resolveFinalTimeToTargetCondition({
    standardTimeToTargetCondition: proposed.standardTimeToTargetCondition,
    advanceYears: proposed.advanceYears,
    delayYears: proposed.delayYears,
    timeMultiplier: proposed.timeMultiplier
  })
  if (finalTimeToTargetCondition != null) {
    proposed.finalTimeToTargetCondition = finalTimeToTargetCondition
  }
}
