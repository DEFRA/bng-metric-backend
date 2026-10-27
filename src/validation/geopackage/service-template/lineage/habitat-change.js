import {
  CONDITION_SCORES,
  HEDGEROW_CONDITION_SCORES,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
  normaliseEncroachmentLabel
} from 'bng-library/metric'

import { stripConditionPrefix } from '../../../../utilities/enrichment/shared/condition.js'
import { engineHabitatTypeCandidates } from '../../../../utilities/enrichment/shared/engine-helpers.js'

/**
 * How a post-intervention habitat linked to a baseline parent differs from it
 * (BMD-1083), for the Metric guide's habitats that get worse: a habitat whose
 * condition cannot be maintained is recorded as lost, and created again in its
 * own type in a lower condition; a watercourse that is harmed is recorded as a
 * loss and a creation with a lower condition, more encroachment or a shorter
 * length.
 *
 * Each side is a plain description of one habitat, so the checks of the file
 * (lineage-rules.js) and of the saved document compare them alike:
 * `{ type, broadType, condition, watercourseEncroachment, riparianEncroachment }`.
 */

/**
 * The difference in length, in metres, below which two lengths are the same.
 * A hedgerow split in QGIS, or a copy of its parent, measures its parent's
 * length to far closer than this; a centimetre is far below any length the
 * Metric prices a habitat on.
 */
export const LENGTH_TOLERANCE_METRES = 0.01

const CONDITION_SCORES_BY_LAYER = Object.freeze({
  areas: CONDITION_SCORES,
  hedgerows: HEDGEROW_CONDITION_SCORES,
  watercourses: WATERCOURSE_CONDITION_SCORES
})

const ENCROACHMENTS = Object.freeze([
  ['watercourseEncroachment', WATERCOURSE_ENCROACHMENT_MULTIPLIER],
  ['riparianEncroachment', WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER]
])

const trimmed = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

/** The reference keys a side's habitat may be scored under, area or linear. */
function scoreKeys(layer, side) {
  if (layer === 'areas') {
    return [...engineHabitatTypeCandidates(side)]
  }
  const type = trimmed(side.type)
  return type ? [type] : []
}

/**
 * A side's condition score for its habitat type, from the Metric's tables, or
 * null where the table has none: an unknown type or condition, or one the
 * Metric marks Not Possible.
 *
 * @param {'areas' | 'hedgerows' | 'watercourses'} layer
 * @param {object} side
 * @returns {number | null}
 */
export function conditionScore(layer, side) {
  const condition = trimmed(stripConditionPrefix(side.condition))
  if (!condition) {
    return null
  }
  const table = CONDITION_SCORES_BY_LAYER[layer]
  for (const key of scoreKeys(layer, side)) {
    const score = table[key]?.[condition]
    if (typeof score === 'number') {
      return score
    }
  }
  return null
}

/** Whether the child is in a lower condition than its parent, by score. */
export function isLowerCondition(layer, parent, child) {
  const from = conditionScore(layer, parent)
  const to = conditionScore(layer, child)
  return from !== null && to !== null && to < from
}

/** Whether the child keeps its parent's habitat type. */
export function isSameHabitatType(parent, child) {
  const from = trimmed(parent.type)
  return (
    from !== null && from.toLowerCase() === trimmed(child.type)?.toLowerCase()
  )
}

function encroachmentMultiplier(value, lookup) {
  const label = trimmed(value)
  const multiplier = label ? lookup[normaliseEncroachmentLabel(label)] : null
  return typeof multiplier === 'number' ? multiplier : null
}

/**
 * How a watercourse's encroachment moves from its parent's: `worse` when
 * either of encroachment into the watercourse or into the riparian zone is
 * more (a lower multiplier: No Encroachment, then Minor, then Major), and
 * `better` when either is less. A value the Metric does not know moves
 * neither way.
 *
 * @returns {{ worse: boolean, better: boolean }}
 */
export function encroachmentChange(parent, child) {
  let worse = false
  let better = false
  for (const [field, lookup] of ENCROACHMENTS) {
    const from = encroachmentMultiplier(parent[field], lookup)
    const to = encroachmentMultiplier(child[field], lookup)
    if (from !== null && to !== null) {
      worse ||= to < from
      better ||= to > from
    }
  }
  return { worse, better }
}

/** Whether a length is shorter than its parent's, beyond the tolerance. */
export function isShorter(parentMetres, childMetres) {
  return (
    Number.isFinite(parentMetres) &&
    Number.isFinite(childMetres) &&
    childMetres < parentMetres - LENGTH_TOLERANCE_METRES
  )
}

/**
 * The length of a parent's Created children of its own type together: what
 * the habitat became, however many pieces it is drawn in. A watercourse drawn
 * as two pieces is not shorter than its parent for that alone, so this, not a
 * piece's own length, is the child length watercourseChange compares.
 *
 * @param {object} parentSide
 * @param {Array<{ side: object, lengthMetres: number }>} createdChildren the
 *   parent's Created children, of any type
 * @returns {number}
 */
export function createdInOwnTypeMetres(parentSide, createdChildren) {
  return createdChildren
    .filter((child) => isSameHabitatType(parentSide, child.side))
    .reduce((sum, child) => sum + child.lengthMetres, 0)
}

/**
 * How a Created watercourse linked to a parent differs from it. Of one of its
 * own River Type: It gets worse with a lower condition, more encroachment or a
 * shorter length, or any of these together; with none, it is the parent
 * kept, and should be Retained. It is an encroachment-only change when it
 * keeps its parent's condition and length and only its encroachment gets
 * worse, which is the one change the Metric guide lets be created 10 or more
 * years in advance.
 *
 * @param {{ side: object, lengthMetres: number }} parent
 * @param {{ side: object, lengthMetres: number }} child its `lengthMetres`
 *   the parent's same-type Created children together (createdInOwnTypeMetres)
 * @returns {{ worse: boolean, encroachmentOnly: boolean }}
 */
export function watercourseChange(parent, child) {
  const lowerCondition = isLowerCondition(
    'watercourses',
    parent.side,
    child.side
  )
  const shorter = isShorter(parent.lengthMetres, child.lengthMetres)
  const encroachment = encroachmentChange(parent.side, child.side)
  const sameCondition =
    conditionScore('watercourses', parent.side) !== null &&
    conditionScore('watercourses', parent.side) ===
      conditionScore('watercourses', child.side)
  return {
    worse: lowerCondition || shorter || encroachment.worse,
    encroachmentOnly:
      isSameHabitatType(parent.side, child.side) &&
      sameCondition &&
      !shorter &&
      encroachment.worse &&
      !encroachment.better
  }
}
