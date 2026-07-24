import { MAX_YEARS, MIN_YEARS } from 'bng-metric-engine'

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
 * Clamp to the same [MIN_YEARS, MAX_YEARS] range bng-metric-engine applies
 * before computing timeMultiplier, so the displayed years never contradict
 * the multiplier shown alongside them (e.g. never negative when advance
 * years already meet or exceed the statutory target).
 *
 * @param {number} years
 * @returns {number}
 */
function clampToStatutoryYearsRange(years) {
  if (years < MIN_YEARS) {
    return MIN_YEARS
  }
  if (years > MAX_YEARS) {
    return MAX_YEARS
  }
  return years
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
 * Final time-to-target display for the UI.
 * Format: "{standard - advance + delay} years (timeMultiplier)", clamped to
 * [MIN_YEARS, MAX_YEARS] so it always agrees with the years bng-metric-engine
 * actually used to derive timeMultiplier.
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
  const standardYears = parseStandardYears(standardTimeToTargetCondition)
  const hasValidTimeMultiplier =
    typeof timeMultiplier === 'number' && Number.isFinite(timeMultiplier)
  if (standardYears !== null && hasValidTimeMultiplier) {
    const finalYears = clampToStatutoryYearsRange(
      standardYears -
        finiteYearsOrZero(advanceYears) +
        finiteYearsOrZero(delayYears)
    )
    return `${finalYears} years (${timeMultiplier})`
  }
  return null
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
