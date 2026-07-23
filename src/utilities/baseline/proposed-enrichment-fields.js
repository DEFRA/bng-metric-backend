/**
 * Copy optional post-intervention enrichment fields from an engine result or
 * recompute payload onto a `proposed` sub-object.
 */

const PROPOSED_ENGINE_METRIC_KEYS = Object.freeze([
  'timeMultiplier',
  'difficultyMultiplier',
  'standardTimeToTargetCondition',
  'difficulty'
])

const PROPOSED_DISPLAY_FIELD_KEYS = Object.freeze([
  'advanceOrDelay',
  'finalTimeToTargetCondition'
])

/**
 * @param {object} proposed
 * @param {object} source
 * @param {string} key
 */
function assignWhenPresent(proposed, source, key) {
  if (source[key] != null) {
    proposed[key] = source[key]
  }
}

/**
 * @param {object} proposed
 * @param {object} source
 * @param {readonly string[]} keys
 */
function copyPresentFields(proposed, source, keys) {
  for (const key of keys) {
    assignWhenPresent(proposed, source, key)
  }
}

/**
 * @param {object} proposed
 * @param {object} source
 */
export function copyProposedEngineMetrics(proposed, source) {
  copyPresentFields(proposed, source, PROPOSED_ENGINE_METRIC_KEYS)
}

/**
 * @param {object} proposed
 * @param {object} source
 */
export function copyProposedDisplayFields(proposed, source) {
  copyPresentFields(proposed, source, PROPOSED_DISPLAY_FIELD_KEYS)
}
