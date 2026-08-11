// Completeness rules for post-intervention features, which carry their
// attributes on a `proposed` sub-object and use engine-string presence checks
// so placeholders such as "N/A" do not count as answered.

import { isPresentEngineString } from '../../utilities/enrichment/shared/is-present-engine-string.js'
import { HABITAT_STATUS } from '../upload/habitat-status.js'

/**
 * Post-intervention area habitats require proposed broad type, type, and condition.
 *
 * @param {{ proposed: { broadType: unknown, type: unknown, condition: unknown } }} doc
 * @returns {'Complete'|'Incomplete'}
 */
export function postInterventionAreaStatus(doc) {
  const proposed = doc.proposed ?? {}
  return isPresentEngineString(proposed.broadType) &&
    isPresentEngineString(proposed.type) &&
    isPresentEngineString(proposed.condition)
    ? HABITAT_STATUS.COMPLETE
    : HABITAT_STATUS.INCOMPLETE
}

/**
 * Post-intervention hedgerows require proposed type and condition.
 *
 * @param {{ proposed: { type: unknown, condition: unknown } }} doc
 * @returns {'Complete'|'Incomplete'}
 */
export function postInterventionHedgerowStatus(doc) {
  const proposed = doc.proposed ?? {}
  return isPresentEngineString(proposed.type) &&
    isPresentEngineString(proposed.condition)
    ? HABITAT_STATUS.COMPLETE
    : HABITAT_STATUS.INCOMPLETE
}

/**
 * Post-intervention watercourses require proposed type, condition, riparian
 * encroachment, and watercourse encroachment.
 *
 * @param {{ proposed: { type: unknown, condition: unknown, riparianEncroachment: unknown, watercourseEncroachment: unknown } }} doc
 * @returns {'Complete'|'Incomplete'}
 */
export function postInterventionWatercourseStatus(doc) {
  const proposed = doc.proposed ?? {}
  return isPresentEngineString(proposed.type) &&
    isPresentEngineString(proposed.condition) &&
    isPresentEngineString(proposed.riparianEncroachment) &&
    isPresentEngineString(proposed.watercourseEncroachment)
    ? HABITAT_STATUS.COMPLETE
    : HABITAT_STATUS.INCOMPLETE
}
