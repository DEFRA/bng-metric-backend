// Trading-rules unit calculations (BMD-995).
//
// These functions are deliberately band-agnostic and pure so the same
// primitives can back the watercourse rules today and the hedgerow / area
// rules later. They operate on already-computed unit totals: the per-feature
// unit figures are produced by the retained/created/enhanced calculators, and
// trading rules only aggregate them by habitat type and distinctiveness band.
//
// Nothing here derives Met / Not-met statuses — that is a separate concern
// (BMD-1002, front end). This module produces the unit figures only.

import {
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES
} from './reference-constants.js'
import { resolveLinearDistinctiveness } from './linear-resolvers.js'
import { roundToSigFigs } from './utils.js'

/** Net unit change threshold separating a surplus (> 0) from a deficit (< 0). */
const SURPLUS_THRESHOLD = 0

/** Watercourse distinctiveness bands that carry trading rules in the MVS. */
const MEDIUM_BAND = 'Medium'
const LOW_BAND = 'Low'

/**
 * Coerce a value to a finite number, treating anything else as 0. Mirrors the
 * leniency of the unit summariser so an uncalculated (null) total never
 * poisons an aggregate with NaN.
 *
 * @param {unknown} value
 * @returns {number}
 */
function numericOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * AC1 — net unit change per unique habitat type across baseline and proposed.
 *
 * The delivered total is the sum of a habitat's retained, created and enhanced
 * post-intervention units (enhancement is attributed to the proposed habitat,
 * so units move between types); the baseline total is the sum of that habitat's
 * baseline units. Net unit change is delivered minus baseline.
 *
 * @param {Record<string, number>} baselineUnitsByType type -> summed baseline units
 * @param {Record<string, number>} deliveredUnitsByType type -> summed retained+created+enhanced units
 * @returns {Array<{ habitatType: string, netUnitChange: number }>} one entry per
 *   habitat type present on either side, ordered by habitat type
 */
export function calculateHabitatNetUnitChanges(
  baselineUnitsByType = {},
  deliveredUnitsByType = {}
) {
  const habitatTypes = new Set([
    ...Object.keys(baselineUnitsByType),
    ...Object.keys(deliveredUnitsByType)
  ])
  return [...habitatTypes]
    .sort((a, b) => a.localeCompare(b))
    .map((habitatType) => {
      const delivered = numericOrZero(deliveredUnitsByType[habitatType])
      const baseline = numericOrZero(baselineUnitsByType[habitatType])
      return {
        habitatType,
        netUnitChange: roundToSigFigs(delivered - baseline)
      }
    })
}

/**
 * Sum of the strictly positive net unit changes (a band's total surplus).
 *
 * @param {number[]} netUnitChanges
 * @returns {number} zero or positive
 */
export function sumSurplus(netUnitChanges = []) {
  const total = netUnitChanges
    .filter((value) => value > SURPLUS_THRESHOLD)
    .reduce((sum, value) => sum + value, 0)
  return roundToSigFigs(total)
}

/**
 * Sum of the strictly negative net unit changes (a band's total deficit).
 *
 * @param {number[]} netUnitChanges
 * @returns {number} zero or negative
 */
export function sumDeficit(netUnitChanges = []) {
  const total = netUnitChanges
    .filter((value) => value < SURPLUS_THRESHOLD)
    .reduce((sum, value) => sum + value, 0)
  return roundToSigFigs(total)
}

/**
 * Sum of all net unit changes regardless of sign (a band's net change).
 *
 * @param {number[]} netUnitChanges
 * @returns {number}
 */
export function sumNetChange(netUnitChanges = []) {
  const total = netUnitChanges.reduce((sum, value) => sum + value, 0)
  return roundToSigFigs(total)
}

/**
 * Cumulative availability of units for a lower band: the surplus carried down
 * from a higher band plus the lower band's own net change.
 *
 * @param {number} higherBandSurplus zero or positive, from {@link sumSurplus}
 * @param {number} lowerBandNetChange from {@link sumNetChange}
 * @returns {number}
 */
export function calculateCumulativeAvailability(
  higherBandSurplus,
  lowerBandNetChange
) {
  return roundToSigFigs(higherBandSurplus + lowerBandNetChange)
}

/**
 * Resolve a watercourse type's distinctiveness band and score from the engine's
 * reference tables. Thin wrapper over {@link resolveLinearDistinctiveness} that
 * pins the watercourse category/score maps.
 *
 * @param {string} watercourseType e.g. 'Ditches', 'Canals', 'Culvert'
 * @returns {{ distinctiveness: string, distinctivenessScore: number }}
 */
export function resolveWatercourseDistinctiveness(watercourseType) {
  return resolveLinearDistinctiveness(
    watercourseType,
    WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
    WATERCOURSE_DISTINCTIVENESS_SCORES,
    'watercourse'
  )
}

/**
 * @param {Array<{ habitatType: string, distinctiveness: string, netUnitChange: number }>} habitats
 * @param {string} band
 * @returns {number[]} the net unit changes of the habitats in that band
 */
function netChangesForBand(habitats, band) {
  return habitats
    .filter((habitat) => habitat.distinctiveness === band)
    .map((habitat) => habitat.netUnitChange)
}

/**
 * AC1–AC5 — the full watercourse trading-rules unit figures.
 *
 * @param {Record<string, number>} baselineUnitsByType type -> summed baseline units
 * @param {Record<string, number>} deliveredUnitsByType type -> summed retained+created+enhanced units
 * @returns {{
 *   habitats: Array<{ habitatType: string, distinctiveness: string, netUnitChange: number }>,
 *   medium: { surplus: number, deficit: number },
 *   low: { netChange: number, cumulativeAvailability: number }
 * }}
 */
export function calculateWatercourseTradingRules(
  baselineUnitsByType = {},
  deliveredUnitsByType = {}
) {
  const habitats = calculateHabitatNetUnitChanges(
    baselineUnitsByType,
    deliveredUnitsByType
  ).map((habitat) => ({
    ...habitat,
    distinctiveness: resolveWatercourseDistinctiveness(habitat.habitatType)
      .distinctiveness
  }))

  const mediumChanges = netChangesForBand(habitats, MEDIUM_BAND)
  const lowChanges = netChangesForBand(habitats, LOW_BAND)

  const mediumSurplus = sumSurplus(mediumChanges)
  const lowNetChange = sumNetChange(lowChanges)

  return {
    habitats,
    medium: {
      surplus: mediumSurplus,
      deficit: sumDeficit(mediumChanges)
    },
    low: {
      netChange: lowNetChange,
      cumulativeAvailability: calculateCumulativeAvailability(
        mediumSurplus,
        lowNetChange
      )
    }
  }
}
