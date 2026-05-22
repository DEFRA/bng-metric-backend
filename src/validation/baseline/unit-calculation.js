// Habitat unit calculation and status determination.
//
// Used by the save endpoint for BMD-480: when the user edits the dropdowns on
// an Area Habitat and clicks Save, the backend recomputes the unit value and
// completeness status before persisting the habitat document.
//
// Formula (Statutory Biodiversity Metric, baseline area habitats):
//
//   units = areaHectares
//         × distinctivenessScore
//         × conditionScore
//         × strategicSignificanceMultiplier
//         × spatialRiskMultiplier
//
// Strategic significance and spatial risk are both fixed to 1 for the Minimum
// Viable Service (MVS) — see BMD-315 AC9. They are passed in explicitly so
// later stories can vary them without touching this function.
//
// A habitat is "Complete" when *every* input the formula needs is present and
// valid; otherwise it is "Incomplete" with zero units (BMD-480 AC6).

import {
  distinctivenessByHabitatType,
  distinctivenessScores
} from './reference/habitat-distinctiveness.js'
import { getConditionScore } from './reference/habitat-condition.js'

const SQUARE_METRES_PER_HECTARE = 10_000
const DEFAULT_STRATEGIC_SIGNIFICANCE = 1
const DEFAULT_SPATIAL_RISK = 1

const HABITAT_STATUS = Object.freeze({
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete'
})

/**
 * Resolve the distinctiveness band + numeric score for a (broadType,
 * habitatType) pair. Returns null when either value is missing or the pair has
 * no entry in the reference table.
 *
 * @param {string|null|undefined} broadType
 * @param {string|null|undefined} habitatType
 * @returns {{ distinctiveness: string, score: number }|null}
 */
function resolveDistinctiveness(broadType, habitatType) {
  if (!broadType || !habitatType) {
    return null
  }
  const key = `${broadType} - ${habitatType}`
  const band = distinctivenessByHabitatType[key]
  if (!band) {
    return null
  }
  const entry = distinctivenessScores[band]
  if (!entry) {
    return null
  }
  return { distinctiveness: band, score: entry.score }
}

/**
 * Compute baseline habitat units for an area habitat.
 *
 * Returns 0 whenever any input is missing or invalid — that mirrors the AC6
 * "Scenario B" rule (incomplete habitats save zero units).
 *
 * @param {object} params
 * @param {number|null} params.sizeSquareMetres area in m² (from PostGIS)
 * @param {number|null} params.distinctivenessScore numeric score (0,2,4,6,8)
 * @param {number|null} params.conditionScore numeric score (0–3)
 * @param {number} [params.strategicSignificance] fixed 1 for MVS
 * @param {number} [params.spatialRisk] fixed 1 for MVS
 * @returns {number}
 */
function computeHabitatUnits({
  sizeSquareMetres,
  distinctivenessScore,
  conditionScore,
  strategicSignificance = DEFAULT_STRATEGIC_SIGNIFICANCE,
  spatialRisk = DEFAULT_SPATIAL_RISK
}) {
  if (
    typeof sizeSquareMetres !== 'number' ||
    !Number.isFinite(sizeSquareMetres) ||
    sizeSquareMetres <= 0
  ) {
    return 0
  }
  if (
    typeof distinctivenessScore !== 'number' ||
    !Number.isFinite(distinctivenessScore)
  ) {
    return 0
  }
  if (typeof conditionScore !== 'number' || !Number.isFinite(conditionScore)) {
    return 0
  }
  const areaHectares = sizeSquareMetres / SQUARE_METRES_PER_HECTARE
  return (
    areaHectares *
    distinctivenessScore *
    conditionScore *
    strategicSignificance *
    spatialRisk
  )
}

/**
 * Recompute the derived fields of an area habitat after a dropdown edit.
 *
 * Given the user's selections (broadType, habitatType, condition) and the
 * habitat's existing area, returns the canonical persisted shape: distinct-
 * iveness band + score, condition score, units, and status. Saves zero units
 * + "Incomplete" when any selection is missing or unrecognised.
 *
 * Pure — does no I/O. The caller is responsible for merging the result back
 * into the JSONB habitat document.
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
 *   habitatUnits: number,
 *   status: 'Complete' | 'Incomplete'
 * }}
 */
function recomputeAreaHabitat({
  broadType,
  habitatType,
  condition,
  sizeSquareMetres
}) {
  const distinctiveness = resolveDistinctiveness(broadType, habitatType)
  const habitatKey =
    broadType && habitatType ? `${broadType} - ${habitatType}` : null
  const conditionScore = getConditionScore(habitatKey, condition)
  const distinctivenessScore = distinctiveness?.score ?? null

  const habitatUnits = computeHabitatUnits({
    sizeSquareMetres,
    distinctivenessScore,
    conditionScore
  })

  const complete =
    distinctiveness !== null &&
    conditionScore !== null &&
    typeof sizeSquareMetres === 'number' &&
    Number.isFinite(sizeSquareMetres) &&
    sizeSquareMetres > 0

  return {
    distinctiveness: distinctiveness?.distinctiveness ?? null,
    distinctivenessScore,
    conditionScore,
    habitatUnits: complete ? habitatUnits : 0,
    status: complete ? HABITAT_STATUS.COMPLETE : HABITAT_STATUS.INCOMPLETE
  }
}

export {
  HABITAT_STATUS,
  SQUARE_METRES_PER_HECTARE,
  computeHabitatUnits,
  recomputeAreaHabitat,
  resolveDistinctiveness
}
