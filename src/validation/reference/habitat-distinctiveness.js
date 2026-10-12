// Habitat distinctiveness reference data.
//
// Thin readers over bng-library/metric's distinctiveness category tables so the
// backend and engine cannot drift. There is one table per habitat family —
// area, hedgerow and watercourse — because the same band (e.g. V.High) is keyed
// on a different vocabulary in each:
//   - distinctivenessByHabitatType: area habitat type string → band
//   - distinctivenessByHedgerowType: hedge type string → band
//   - distinctivenessByWatercourseType: river type string → band
//   - distinctivenessScores: band → { score }; preserves the prior local shape
//     (lowercase `score`, no "Trading rules") so existing consumers don't
//     need to change. Trading-rule guidance is exposed separately via
//     habitat-reference.js's tradingRulesByDistinctiveness.

import {
  DISTINCTIVENESS_CATEGORIES,
  DISTINCTIVENESS_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES
} from 'bng-library/metric'

const distinctivenessByHabitatType = DISTINCTIVENESS_CATEGORIES
const distinctivenessByHedgerowType = HEDGEROW_DISTINCTIVENESS_CATEGORIES
const distinctivenessByWatercourseType = WATERCOURSE_DISTINCTIVENESS_CATEGORIES

const distinctivenessScores = Object.fromEntries(
  Object.entries(DISTINCTIVENESS_SCORES).map(([band, { Score }]) => [
    band,
    { score: Score }
  ])
)

/**
 * Build a case-insensitive lookup of a habitat type's key in one
 * distinctiveness table. The returned function trims the type and matches
 * exactly first, then falls back to a case-insensitive scan so minor formatting
 * differences in the GeoPackage don't fail. Returns the key as the table
 * spells it, or null for an unrecognised (or non-string) type.
 *
 * @param {Record<string, string>} table habitat type string → band
 * @returns {(habitatType: string|null|undefined) => string|null}
 */
function makeKeyLookup(table) {
  return (habitatType) => {
    if (!habitatType || typeof habitatType !== 'string') {
      return null
    }
    const key = habitatType.trim()
    if (key in table) {
      return key
    }
    const lower = key.toLowerCase()
    return Object.keys(table).find((k) => k.toLowerCase() === lower) ?? null
  }
}

/**
 * Build a case-insensitive band lookup over one distinctiveness table (see
 * makeKeyLookup). Returns null for an unrecognised (or non-string) type.
 *
 * @param {Record<string, string>} table habitat type string → band
 * @returns {(habitatType: string|null|undefined) => string|null}
 */
function makeBandLookup(table) {
  const lookupKey = makeKeyLookup(table)
  return (habitatType) => {
    const key = lookupKey(habitatType)
    return key === null ? null : table[key]
  }
}

/**
 * Look up the distinctiveness band for an area habitat type, returning null if
 * the type is not recognised.
 *
 * @param {string|null|undefined} habitatType
 * @returns {string|null}
 */
const getDistinctiveness = makeBandLookup(distinctivenessByHabitatType)

/**
 * Look up the distinctiveness band for a hedgerow (hedge) type.
 *
 * @param {string|null|undefined} hedgerowType
 * @returns {string|null}
 */
const getHedgerowDistinctiveness = makeBandLookup(distinctivenessByHedgerowType)

/**
 * Look up the distinctiveness band for a watercourse (river) type.
 *
 * @param {string|null|undefined} watercourseType
 * @returns {string|null}
 */
const getWatercourseDistinctiveness = makeBandLookup(
  distinctivenessByWatercourseType
)

/**
 * The metric's spelling of an area habitat type ("<broad> - <type>"), a hedge
 * type or a river type, matched as the band lookups match it; null when the
 * type is not recognised.
 *
 * @type {(habitatType: string|null|undefined) => string|null}
 */
const canonicalHabitatType = makeKeyLookup(distinctivenessByHabitatType)
/** @type {(hedgerowType: string|null|undefined) => string|null} */
const canonicalHedgerowType = makeKeyLookup(distinctivenessByHedgerowType)
/** @type {(watercourseType: string|null|undefined) => string|null} */
const canonicalWatercourseType = makeKeyLookup(distinctivenessByWatercourseType)

export {
  canonicalHabitatType,
  canonicalHedgerowType,
  canonicalWatercourseType,
  distinctivenessScores,
  distinctivenessByHabitatType,
  distinctivenessByHedgerowType,
  distinctivenessByWatercourseType,
  getDistinctiveness,
  getHedgerowDistinctiveness,
  getWatercourseDistinctiveness
}
