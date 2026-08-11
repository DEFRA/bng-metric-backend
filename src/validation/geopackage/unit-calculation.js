// Habitat unit calculation and status determination for feature edits.
//
// Used by the feature PUT routes (BMD-480 area, BMD-501 hedgerow): when the
// user edits the dropdowns and clicks Save, the backend recomputes units and
// completeness before persisting. Both area and hedgerow recompute delegate
// to bng-metric-engine so the calculator stays the single source of truth.
//
// All recompute functions return the canonical persisted derived shape so
// `applyFeatureUpdate` can splice the result into any layer without per-type
// branching.
//
// The engine throws on null/unknown/invalid inputs (it is designed for the
// happy path of a complete row). The soft-fail policy here: any missing or
// invalid dropdown returns the canonical shape with `status: 'Incomplete'`
// and zero units, but the distinctiveness band is still resolved as soon as
// the habitat-type pair is recognised so the UI can display it before the
// user picks a condition.

import {
  BaselineLookupError,
  calculateAreaHabitatBaseline,
  calculateHedgerowBaseline,
  calculateWatercourseBaseline,
  resolveDistinctiveness
} from 'bng-metric-engine'
import {
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  hedgerowDistinctivenessScores,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  watercourseDistinctivenessScores
} from '../reference/habitat-reference.js'

const SQUARE_METRES_PER_HECTARE = 10_000
const METRES_PER_KILOMETRE = 1_000

const HABITAT_STATUS = Object.freeze({
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete'
})

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function lookupAreaDistinctiveness(habitatKey) {
  try {
    return resolveDistinctiveness(habitatKey)
  } catch (err) {
    if (err instanceof BaselineLookupError) {
      return null
    }
    throw err
  }
}

function lookupHedgerowDistinctiveness(habitatType) {
  const band = HEDGEROW_DISTINCTIVENESS_CATEGORIES[habitatType]
  if (!band) {
    return null
  }
  const score = hedgerowDistinctivenessScores[band]?.score
  if (typeof score !== 'number') {
    return null
  }
  return { distinctiveness: band, distinctivenessScore: score }
}

function lookupWatercourseDistinctiveness(habitatType) {
  const band = WATERCOURSE_DISTINCTIVENESS_CATEGORIES[habitatType]
  if (!band) {
    return null
  }
  const score = watercourseDistinctivenessScores[band]?.score
  if (typeof score !== 'number') {
    return null
  }
  return { distinctiveness: band, distinctivenessScore: score }
}

function buildIncomplete(distinct) {
  return {
    distinctiveness: distinct?.distinctiveness ?? null,
    distinctivenessScore: distinct?.distinctivenessScore ?? null,
    conditionScore: null,
    units: 0,
    status: HABITAT_STATUS.INCOMPLETE
  }
}

/**
 * Recompute the derived fields of an area habitat after a dropdown edit.
 *
 * @param {object} params
 * @param {string|null|undefined} params.broadType
 * @param {string|null|undefined} params.habitatType
 * @param {string|null|undefined} params.condition
 * @param {number|null|undefined} params.sizeSquareMetres
 * @returns {{
 *   distinctiveness: string|null,
 *   distinctivenessScore: number|null,
 *   conditionScore: number|null,
 *   units: number,
 *   status: 'Complete' | 'Incomplete'
 * }}
 */
function recomputeAreaHabitat({
  broadType,
  habitatType,
  condition,
  sizeSquareMetres
}) {
  if (!broadType || !habitatType) {
    return buildIncomplete(null)
  }
  const habitatKey = `${broadType} - ${habitatType}`
  const distinct = lookupAreaDistinctiveness(habitatKey)
  if (!distinct) {
    return buildIncomplete(null)
  }
  if (!condition || !isPositiveNumber(sizeSquareMetres)) {
    return buildIncomplete(distinct)
  }

  try {
    const sizeHa = sizeSquareMetres / SQUARE_METRES_PER_HECTARE
    const result = calculateAreaHabitatBaseline(sizeHa, habitatKey, condition)
    return {
      distinctiveness: result.distinctiveness,
      distinctivenessScore: result.distinctivenessScore,
      conditionScore: result.conditionScore,
      units: result.units,
      status: HABITAT_STATUS.COMPLETE
    }
  } catch (err) {
    // Engine rejects the (habitat, condition) pair as "Not Possible". The
    // route treats this as the user having picked an incompatible condition
    // mid-flight — keep distinctiveness, drop condition score and units.
    if (err instanceof BaselineLookupError) {
      return buildIncomplete(distinct)
    }
    throw err
  }
}

/**
 * Recompute the derived fields of a hedgerow habitat after a dropdown edit.
 *
 * The shape matches `recomputeAreaHabitat` so `applyFeatureUpdate` can splice
 * the result into the hedgerows layer without per-type branching.
 *
 * @param {object} params
 * @param {string|null|undefined} params.habitatType
 * @param {string|null|undefined} params.condition
 * @param {number|null|undefined} params.sizeMetres
 */
function recomputeHedgerow({ habitatType, condition, sizeMetres }) {
  if (!habitatType) {
    return buildIncomplete(null)
  }
  const distinct = lookupHedgerowDistinctiveness(habitatType)
  if (!distinct) {
    return buildIncomplete(null)
  }
  if (!condition || !isPositiveNumber(sizeMetres)) {
    return buildIncomplete(distinct)
  }

  try {
    const lengthKm = sizeMetres / METRES_PER_KILOMETRE
    const result = calculateHedgerowBaseline(lengthKm, habitatType, condition)
    return {
      distinctiveness: result.distinctiveness,
      distinctivenessScore: result.distinctivenessScore,
      conditionScore: result.conditionScore,
      units: result.units,
      status: HABITAT_STATUS.COMPLETE
    }
  } catch (err) {
    // Engine rejects the (habitat, condition) pair as "Not Possible" — keep
    // the resolved distinctiveness but drop condition score and units.
    if (err instanceof BaselineLookupError) {
      return buildIncomplete(distinct)
    }
    throw err
  }
}

/**
 * Recompute the derived fields of a watercourse habitat after a dropdown edit.
 *
 * Units require all four dropdowns (habitat type, condition, watercourse
 * encroachment, riparian encroachment) plus a positive length; any missing
 * value returns the canonical incomplete shape with zero units — matching the
 * BMD-597 Save rules (Scenario A complete / Scenario B incomplete). The
 * distinctiveness band is still resolved from the habitat type alone so the
 * saved feature carries it even for an incomplete row.
 *
 * The shape matches `recomputeAreaHabitat` so `applyFeatureUpdate` can splice
 * the result into the watercourses layer without per-type branching. Extra
 * watercourse-only fields (`waterEncroachmentMultiplier`,
 * `riparianEncroachmentMultiplier`) ride along for parity with the enrich path.
 *
 * @param {object} params
 * @param {string|null|undefined} params.habitatType
 * @param {string|null|undefined} params.condition
 * @param {string|null|undefined} params.watercourseEncroachment
 * @param {string|null|undefined} params.riparianEncroachment
 * @param {number|null|undefined} params.sizeMetres
 */
function recomputeWatercourse({
  habitatType,
  condition,
  watercourseEncroachment,
  riparianEncroachment,
  sizeMetres
}) {
  if (!habitatType) {
    return buildIncomplete(null)
  }
  const distinct = lookupWatercourseDistinctiveness(habitatType)
  if (!distinct) {
    return buildIncomplete(null)
  }
  if (
    !condition ||
    !watercourseEncroachment ||
    !riparianEncroachment ||
    !isPositiveNumber(sizeMetres)
  ) {
    return buildIncomplete(distinct)
  }

  try {
    const lengthKm = sizeMetres / METRES_PER_KILOMETRE
    const result = calculateWatercourseBaseline(
      lengthKm,
      habitatType,
      condition,
      watercourseEncroachment,
      riparianEncroachment
    )
    return {
      distinctiveness: result.distinctiveness,
      distinctivenessScore: result.distinctivenessScore,
      conditionScore: result.conditionScore,
      units: result.units,
      status: HABITAT_STATUS.COMPLETE,
      waterEncroachmentMultiplier: result.waterEncroachmentMultiplier,
      riparianEncroachmentMultiplier: result.riparianEncroachmentMultiplier
    }
  } catch (err) {
    // Engine rejects one of the (habitat, condition, encroachment) values as
    // unrecognised — treat as an incomplete mid-flight selection: keep the
    // resolved distinctiveness but drop condition score and units.
    if (err instanceof BaselineLookupError) {
      return buildIncomplete(distinct)
    }
    throw err
  }
}

export {
  HABITAT_STATUS,
  recomputeAreaHabitat,
  recomputeHedgerow,
  recomputeWatercourse
}
