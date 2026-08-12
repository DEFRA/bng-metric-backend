// Completeness rules for baseline features, which carry their attributes on the
// feature itself. The post-intervention equivalents read a `proposed`
// sub-object instead — see
// ../post-intervention/calculate-post-intervention-statuses.js.

import { HABITAT_STATUS } from '../upload/habitat-status.js'

/**
 * Area habitats require broad habitat type, habitat type, and condition.
 *
 * @param {{ broadType: unknown, type: unknown, condition: unknown }} doc
 * @returns {'Complete'|'Incomplete'}
 */
export function areaStatus(doc) {
  return doc.broadType && doc.type && doc.condition
    ? HABITAT_STATUS.COMPLETE
    : HABITAT_STATUS.INCOMPLETE
}

/**
 * Hedgerows require habitat type and condition.
 *
 * @param {{ type: unknown, condition: unknown }} doc
 * @returns {'Complete'|'Incomplete'}
 */
export function hedgerowStatus(doc) {
  return doc.type && doc.condition
    ? HABITAT_STATUS.COMPLETE
    : HABITAT_STATUS.INCOMPLETE
}

/**
 * Watercourses require habitat type, condition, riparian encroachment, and
 * watercourse encroachment.
 *
 * @param {{ type: unknown, condition: unknown, riparianEncroachment: unknown, watercourseEncroachment: unknown }} doc
 * @returns {'Complete'|'Incomplete'}
 */
export function watercourseStatus(doc) {
  return doc.type &&
    doc.condition &&
    doc.riparianEncroachment &&
    doc.watercourseEncroachment
    ? HABITAT_STATUS.COMPLETE
    : HABITAT_STATUS.INCOMPLETE
}
