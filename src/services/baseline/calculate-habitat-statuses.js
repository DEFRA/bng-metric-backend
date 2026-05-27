export const HABITAT_STATUS = {
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete'
}

/**
 * AC1 / AC4 — area habitats require broadType, type, and condition.
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
 * AC2 / AC5 — hedgerows require type and condition.
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
 * AC3 / AC6 — watercourses require type, condition, riparianEncroachment,
 * and watercourseEncroachment.
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
