// Habitat unit calculation and status determination for feature edits.
//
// Used by the feature PUT routes (BMD-480 area, BMD-501 hedgerow): when the
// user edits the dropdowns and clicks Save, the backend recomputes units and
// completeness before persisting. Area work delegates to bng-metric-engine
// so the calculator stays the single source of truth; hedgerow scoring lives
// in this repo's reference module until BMD-427/428 lands the engine support.
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
  resolveDistinctiveness
} from 'bng-metric-engine'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  distinctivenessScores
} from './reference/habitat-reference.js'

const SQUARE_METRES_PER_HECTARE = 10_000
const METRES_PER_KILOMETRE = 1_000
const HEDGEROW_STRATEGIC_SIGNIFICANCE = 1
const NOT_POSSIBLE = 'Not Possible'

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

function lookupHedgerowDistinctiveness(habitatType, categories) {
  const band = categories[habitatType]
  if (!band) {
    return null
  }
  const score = distinctivenessScores[band]?.score
  if (typeof score !== 'number') {
    return null
  }
  return { distinctiveness: band, distinctivenessScore: score }
}

function lookupHedgerowConditionScore(habitatType, condition, scoresLookup) {
  const scoresByCondition = scoresLookup[habitatType]
  if (!scoresByCondition) {
    return null
  }
  const score = scoresByCondition[condition]
  if (score === undefined || score === NOT_POSSIBLE) {
    return null
  }
  return score
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
 * Until BMD-427/428 publishes hedgerow scoring through bng-metric-engine the
 * default reference data is empty, so every production call falls through to
 * Incomplete / 0 units. Tests inject `references` to exercise the happy paths.
 *
 * @param {object} params
 * @param {string|null|undefined} params.habitatType
 * @param {string|null|undefined} params.condition
 * @param {number|null|undefined} params.sizeMetres
 * @param {{ distinctivenessByType?: object, conditionScores?: object }} [params.references]
 */
function recomputeHedgerow({
  habitatType,
  condition,
  sizeMetres,
  references = {}
}) {
  const distinctivenessByType =
    references.distinctivenessByType ?? HEDGEROW_DISTINCTIVENESS_CATEGORIES
  const conditionScores =
    references.conditionScores ?? HEDGEROW_CONDITION_SCORES

  if (!habitatType) {
    return buildIncomplete(null)
  }
  const distinct = lookupHedgerowDistinctiveness(
    habitatType,
    distinctivenessByType
  )
  if (!distinct) {
    return buildIncomplete(null)
  }
  if (!condition || !isPositiveNumber(sizeMetres)) {
    return buildIncomplete(distinct)
  }
  const conditionScore = lookupHedgerowConditionScore(
    habitatType,
    condition,
    conditionScores
  )
  if (typeof conditionScore !== 'number') {
    return buildIncomplete(distinct)
  }

  const lengthKm = sizeMetres / METRES_PER_KILOMETRE
  const units =
    lengthKm *
    distinct.distinctivenessScore *
    conditionScore *
    HEDGEROW_STRATEGIC_SIGNIFICANCE
  return {
    distinctiveness: distinct.distinctiveness,
    distinctivenessScore: distinct.distinctivenessScore,
    conditionScore,
    units,
    status: HABITAT_STATUS.COMPLETE
  }
}

export { HABITAT_STATUS, recomputeAreaHabitat, recomputeHedgerow }
