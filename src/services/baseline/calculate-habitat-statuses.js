import { isPresentEngineString } from '../../utilities/baseline/is-present-engine-string.js'

export const HABITAT_STATUS = {
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete'
}

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
