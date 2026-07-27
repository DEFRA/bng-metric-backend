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
 * @param {unknown} value
 * @returns {string | null}
 */
function formatStandardYearsDisplay(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
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
 * Format: "{standardTimeToTargetCondition} years (timeMultiplier)"
 *
 * @param {{
 *   standardTimeToTargetCondition: unknown,
 *   timeMultiplier: unknown
 * }} input
 * @returns {string | null}
 */
export function resolveFinalTimeToTargetCondition({
  standardTimeToTargetCondition,
  timeMultiplier
}) {
  const standardYears = formatStandardYearsDisplay(
    standardTimeToTargetCondition
  )
  const hasValidTimeMultiplier =
    typeof timeMultiplier === 'number' && Number.isFinite(timeMultiplier)
  if (standardYears !== null && hasValidTimeMultiplier) {
    return `${standardYears} years (${timeMultiplier})`
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
    timeMultiplier: proposed.timeMultiplier
  })
  if (finalTimeToTargetCondition != null) {
    proposed.finalTimeToTargetCondition = finalTimeToTargetCondition
  }
}
