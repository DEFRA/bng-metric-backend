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
 * Final time-to-target display incorporating advance/delay and difficulty.
 * Format: "{standard - advance + delay} years - {difficultyMultiplier}"
 *
 * @param {{
 *   standardTimeToTargetCondition: unknown,
 *   advanceYears: unknown,
 *   delayYears: unknown,
 *   difficultyMultiplier: unknown
 * }} input
 * @returns {string | null}
 */
export function resolveFinalTimeToTargetCondition({
  standardTimeToTargetCondition,
  advanceYears,
  delayYears,
  difficultyMultiplier
}) {
  const standardYears = parseStandardYears(standardTimeToTargetCondition)
  if (standardYears === null) {
    return null
  }
  if (
    typeof difficultyMultiplier !== 'number' ||
    !Number.isFinite(difficultyMultiplier)
  ) {
    return null
  }
  const finalYears =
    standardYears -
    finiteYearsOrZero(advanceYears) +
    finiteYearsOrZero(delayYears)
  return `${finalYears} years - ${difficultyMultiplier}`
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
    difficultyMultiplier: proposed.difficultyMultiplier
  })
  if (finalTimeToTargetCondition != null) {
    proposed.finalTimeToTargetCondition = finalTimeToTargetCondition
  }
}
