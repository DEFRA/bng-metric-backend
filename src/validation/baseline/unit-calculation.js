// Habitat unit calculation and status determination.
//
// Used by the area-habitat PUT route (BMD-480): when the user edits the
// dropdowns and clicks Save, the backend recomputes units and completeness
// before persisting. Delegates reference lookups and arithmetic to
// bng-metric-engine so the calculator stays the single source of truth.
//
// The engine throws on null/unknown/invalid inputs (it is designed for the
// happy path of a complete habitat row). This wrapper applies the BMD-480
// AC6 soft-fail policy: any missing or invalid dropdown returns the habitat
// with `status: 'Incomplete'` and zero units, but the distinctiveness band
// is still resolved as soon as the (broad, habitat type) pair is recognised
// so the UI can display it before the user picks a condition.

import {
  BaselineLookupError,
  calculateAreaHabitatBaseline,
  resolveDistinctiveness
} from 'bng-metric-engine'

const SQUARE_METRES_PER_HECTARE = 10_000

const HABITAT_STATUS = Object.freeze({
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete'
})

function isValidArea(sizeSquareMetres) {
  return (
    typeof sizeSquareMetres === 'number' &&
    Number.isFinite(sizeSquareMetres) &&
    sizeSquareMetres > 0
  )
}

function lookupDistinctiveness(habitatKey) {
  try {
    return resolveDistinctiveness(habitatKey)
  } catch (err) {
    if (err instanceof BaselineLookupError) {
      return null
    }
    throw err
  }
}

function buildIncomplete(distinct) {
  return {
    distinctiveness: distinct?.distinctiveness ?? null,
    distinctivenessScore: distinct?.distinctivenessScore ?? null,
    conditionScore: null,
    habitatUnits: 0,
    status: HABITAT_STATUS.INCOMPLETE
  }
}

/**
 * Recompute the derived fields of an area habitat after a dropdown edit.
 *
 * Given the user's selections (broadType, habitatType, condition) and the
 * habitat's existing area, returns the canonical persisted shape:
 * distinctiveness band + score, condition score, units, and status. Saves
 * zero units + "Incomplete" when any selection is missing or unrecognised.
 * Pure — does no I/O.
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
  if (!broadType || !habitatType) {
    return buildIncomplete(null)
  }
  const habitatKey = `${broadType} - ${habitatType}`
  const distinct = lookupDistinctiveness(habitatKey)
  if (!distinct) {
    return buildIncomplete(null)
  }
  if (!condition || !isValidArea(sizeSquareMetres)) {
    return buildIncomplete(distinct)
  }

  try {
    const sizeHa = sizeSquareMetres / SQUARE_METRES_PER_HECTARE
    const result = calculateAreaHabitatBaseline(sizeHa, habitatKey, condition)
    return {
      distinctiveness: result.distinctiveness,
      distinctivenessScore: result.distinctivenessScore,
      conditionScore: result.conditionScore,
      habitatUnits: result.units,
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

export { HABITAT_STATUS, recomputeAreaHabitat }
