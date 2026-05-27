// Habitat condition reference data.
//
// Thin reader over bng-metric-engine's CONDITION_SCORES so backend and engine
// cannot drift on habitat type strings or per-cell scores. The engine stores
// each (habitat, condition) cell as a number (permitted, with that score) or
// the string "Not Possible" (disallowed); we collapse the latter to null so
// callers treat it as "incomplete / invalid for unit calculation".

import { CONDITION_SCORES } from 'bng-metric-engine'

/**
 * Look up the numeric condition score for a (habitatType, condition) pair.
 * Returns `null` when the combination is not permitted or unknown — callers
 * treat that as "incomplete", scoring zero habitat units.
 *
 * @param {string|null|undefined} habitatType
 * @param {string|null|undefined} condition
 * @returns {number|null}
 */
function getConditionScore(habitatType, condition) {
  if (!habitatType || !condition) {
    return null
  }
  const row = CONDITION_SCORES[habitatType]
  if (!row) {
    return null
  }
  const score = row[condition]
  return typeof score === 'number' ? score : null
}

export { getConditionScore }
