// An edit's fields as apply-feature-update.js reads them: trimmed, a blank
// dropdown read as cleared, and a reference or comment the edit leaves alone
// read as left alone. Split out of apply-feature-update.js.

import { cleanComment } from '../../validation/geopackage/comment-check.js'
import { cleanHabitatRef } from '../../validation/geopackage/habitat-ref-check.js'

function blankToNull(value) {
  if (value === null || value === undefined) {
    return null
  } else {
    const trimmed = typeof value === 'string' ? value.trim() : value
    if (trimmed === '') {
      return null
    } else {
      return trimmed
    }
  }
}

/**
 * The edited ref as it is stored, or undefined when the edit leaves the ref
 * alone. Unlike the dropdown fields, an absent ref is not a request to clear
 * it: a habitat must always have one (BMD-1058), and baseline renaming (BMD-1061) and full Created-area edits
 * send it. The route has already refused a blank one.
 *
 * @param {unknown} ref
 * @returns {string | undefined}
 */
function normalizeRef(ref) {
  if (ref === undefined || ref === null) {
    return undefined
  }
  const cleaned = cleanHabitatRef(ref)
  return cleaned === '' ? undefined : cleaned
}

/**
 * The edited comment as it is stored, or undefined when the edit leaves it
 * alone. An absent comment is not a request to clear it. Blank and
 * whitespace-only become null.
 *
 * @param {object} edits
 * @returns {string | null | undefined}
 */
function normalizeComment(edits) {
  if (!Object.hasOwn(edits, 'comment')) {
    return undefined
  }
  return cleanComment(edits.comment)
}

/**
 * @param {object} [edits] the edit as the route received it
 * @returns {object} the edit as apply-feature-update.js applies it
 */
export function normalizeEdits(edits = {}) {
  return {
    ref: normalizeRef(edits.ref),
    ...(Object.hasOwn(edits, 'advanceYears')
      ? {
          strategicSignificance:
            edits.strategicSignificance === undefined
              ? undefined
              : blankToNull(edits.strategicSignificance),
          advanceYears: edits.advanceYears,
          delayYears: edits.delayYears
        }
      : {}),
    broadType: blankToNull(edits.broadType),
    habitatType: blankToNull(edits.habitatType),
    condition: blankToNull(edits.condition),
    watercourseEncroachment: blankToNull(edits.watercourseEncroachment),
    riparianEncroachment: blankToNull(edits.riparianEncroachment),
    // A tree's size class; undefined leaves it alone, as it cannot be cleared.
    treeSize: blankToNull(edits.treeSize) ?? undefined,
    comment: normalizeComment(edits)
  }
}
