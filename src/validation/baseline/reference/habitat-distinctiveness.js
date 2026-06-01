// Habitat distinctiveness reference data.
//
// Thin readers over bng-metric-engine's DISTINCTIVENESS_CATEGORIES and
// DISTINCTIVENESS_SCORES so backend and engine cannot drift.
//   - distinctivenessByHabitatType: habitat type string → distinctiveness band
//   - distinctivenessScores: band → { score }; preserves the prior local shape
//     (lowercase `score`, no "Trading rules") so existing consumers don't
//     need to change. Trading-rule guidance is exposed separately via
//     habitat-reference.js's tradingRulesByDistinctiveness.

import {
  DISTINCTIVENESS_CATEGORIES,
  DISTINCTIVENESS_SCORES
} from 'bng-metric-engine'

const distinctivenessByHabitatType = DISTINCTIVENESS_CATEGORIES

const distinctivenessScores = Object.fromEntries(
  Object.entries(DISTINCTIVENESS_SCORES).map(([band, { Score }]) => [
    band,
    { score: Score }
  ])
)

/**
 * Look up the distinctiveness band for a habitat type, returning null if the
 * type is not recognised. Lookup is case-insensitive on a trimmed key so minor
 * formatting differences in the GeoPackage don't fail.
 *
 * @param {string|null|undefined} habitatType
 * @returns {string|null}
 */
function getDistinctiveness(habitatType) {
  if (!habitatType || typeof habitatType !== 'string') {
    return null
  }
  const key = habitatType.trim()
  if (key in distinctivenessByHabitatType) {
    return distinctivenessByHabitatType[key]
  }
  const lower = key.toLowerCase()
  for (const k of Object.keys(distinctivenessByHabitatType)) {
    if (k.toLowerCase() === lower) {
      return distinctivenessByHabitatType[k]
    }
  }
  return null
}

export {
  distinctivenessScores,
  distinctivenessByHabitatType,
  getDistinctiveness
}
