// Reference data for the Habitat Details page (BMD-315): broad habitats,
// habitat types, conditions, and trading rules. Thin readers over
// bng-metric-engine's CONDITION_SCORES and DISTINCTIVENESS_SCORES so backend
// and engine cannot drift.

import {
  CONDITION_SCORES,
  DISTINCTIVENESS_SCORES,
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES
} from 'bng-metric-engine'
import {
  distinctivenessByHabitatType,
  distinctivenessScores
} from './habitat-distinctiveness.js'

// Hedgerow scores differ from area scores at V.Low (1 vs 0) per the statutory
// metric tables, so the hedgerow path must read its own scores table.
const hedgerowDistinctivenessScores = Object.fromEntries(
  Object.entries(HEDGEROW_DISTINCTIVENESS_SCORES).map(([band, { Score }]) => [
    band,
    { score: Score }
  ])
)

export { distinctivenessScores } from './habitat-distinctiveness.js'
export { hedgerowDistinctivenessScores }

const NOT_POSSIBLE = 'Not Possible'

// Trading rules per AC10. Sourced from the engine's "Trading rules"
// strings so the wording stays in lockstep with the calculator.
const tradingRulesByDistinctiveness = Object.fromEntries(
  Object.entries(DISTINCTIVENESS_SCORES).map(([band, entry]) => [
    band,
    entry['Trading rules']
  ])
)

// Distinctiveness bands in the MVS scope — the dropdowns for both the area
// habitats journey and the hedgerow journey (BMD-500 AC6b) filter to these
// bands. High and V.High are excluded because neither journey lets the user
// pick them.
const MVS_BANDS = new Set(['V.Low', 'Low', 'Medium'])

// Split a habitat type key like 'Grassland - Lowland meadows' or
// 'Rocky shore - High energy littoral rock - on peat, clay or chalk' into
// { broadHabitat, habitatType } on the first ' - ' only.
function splitHabitatTypeKey(key) {
  const sep = ' - '
  const idx = key.indexOf(sep)
  if (idx < 0) {
    return { broadHabitat: key, habitatType: '' }
  }
  return {
    broadHabitat: key.slice(0, idx),
    habitatType: key.slice(idx + sep.length)
  }
}

/**
 * All (broad habitat, habitat type, distinctiveness) triples for area habitats.
 * Used by the broad-habitats and habitat-types reference endpoints.
 *
 * @param {{ areaOnly?: boolean }} [options]
 * @returns {Array<{ broadHabitat: string, habitatType: string, distinctiveness: string }>}
 */
function getHabitatsByBroad(options = {}) {
  const { areaOnly = false } = options
  const rows = []
  for (const [key, distinctiveness] of Object.entries(
    distinctivenessByHabitatType
  )) {
    if (areaOnly && !MVS_BANDS.has(distinctiveness)) {
      continue
    }
    const { broadHabitat, habitatType } = splitHabitatTypeKey(key)
    rows.push({ broadHabitat, habitatType, distinctiveness })
  }
  return rows
}

/**
 * The distinct list of broad habitats present in the area-habitats journey,
 * sorted alphabetically. Excludes broads with no V.Low/Low/Medium entries.
 *
 * @returns {string[]}
 */
function getAreaBroadHabitats() {
  const broads = new Set()
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    broads.add(row.broadHabitat)
  }
  return [...broads].sort((a, b) => a.localeCompare(b))
}

/**
 * Habitat types (sorted) within a broad habitat that qualify for the area
 * habitats journey. Each entry carries its distinctiveness band + score so
 * the frontend can render AC2 (Distinctiveness text on habitat-type change)
 * client-side without a further round trip.
 *
 * @param {string} broadHabitat
 * @returns {Array<{ name: string, distinctiveness: string, distinctivenessScore: number }>}
 */
function getAreaHabitatTypes(broadHabitat) {
  const types = []
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    if (row.broadHabitat === broadHabitat) {
      types.push({
        name: row.habitatType,
        distinctiveness: row.distinctiveness,
        distinctivenessScore: distinctivenessScores[row.distinctiveness]?.score
      })
    }
  }
  return types.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Every area habitat type grouped by broad habitat. Returned in one response
 * by /reference/habitat-types-by-broad so the BMD-480 client-side dropdown JS
 * can avoid the 1 + N round trips it would otherwise need.
 *
 * @returns {Object<string, Array<{ name: string, distinctiveness: string, distinctivenessScore: number }>>}
 */
function getAreaHabitatTypesByBroad() {
  const grouped = {}
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    const list = grouped[row.broadHabitat] ?? []
    list.push({
      name: row.habitatType,
      distinctiveness: row.distinctiveness,
      distinctivenessScore: distinctivenessScores[row.distinctiveness]?.score
    })
    grouped[row.broadHabitat] = list
  }
  for (const broad of Object.keys(grouped)) {
    grouped[broad].sort((a, b) => a.name.localeCompare(b.name))
  }
  return grouped
}

/**
 * Condition options for a habitat type, in the engine's canonical order, with
 * "Not Possible" entries removed. Returns [] for habitat types the engine does
 * not know about.
 *
 * @param {string} habitatType
 * @returns {Array<{ condition: string, score: number }>}
 */
function getConditionsForHabitatType(habitatType) {
  const scoresByCondition = CONDITION_SCORES[habitatType]
  if (!scoresByCondition) {
    return []
  }
  const out = []
  for (const [condition, score] of Object.entries(scoresByCondition)) {
    if (score !== NOT_POSSIBLE) {
      out.push({ condition, score })
    }
  }
  return out
}

// Hedgerow reference data comes from the bundled engine (BMD-427/428).
// Shapes match the area equivalents so the frontend strategy reuses the
// same view-model code.

/**
 * Hedgerow habitat types in the MVS scope (V.Low / Low / Medium), sorted by
 * name. Each entry carries its distinctiveness band + score so the client can
 * derive distinctiveness text without a round trip.
 *
 * The `categories` parameter is exposed for tests so the logic can be
 * exercised before BMD-427/428 populates the real engine data; production
 * callers should use the default.
 *
 * @param {Object<string, string>} [categories]
 * @returns {Array<{ name: string, distinctiveness: string, distinctivenessScore: number }>}
 */
function getHedgerowHabitatTypes(
  categories = HEDGEROW_DISTINCTIVENESS_CATEGORIES
) {
  const types = []
  for (const [name, distinctiveness] of Object.entries(categories)) {
    if (!MVS_BANDS.has(distinctiveness)) {
      continue
    }
    types.push({
      name,
      distinctiveness,
      distinctivenessScore:
        hedgerowDistinctivenessScores[distinctiveness]?.score
    })
  }
  return types.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Condition options for a hedgerow habitat type, in the engine's canonical
 * order, with "Not Possible" entries removed. Returns [] for hedgerow types
 * the engine does not know about.
 *
 * The `scoresLookup` parameter is exposed for tests so the logic can be
 * exercised before BMD-427/428 populates the real engine data; production
 * callers should use the default.
 *
 * @param {string} habitatType
 * @param {Object<string, Object<string, number|string>>} [scoresLookup]
 * @returns {Array<{ condition: string, score: number }>}
 */
function getConditionsForHedgerowType(
  habitatType,
  scoresLookup = HEDGEROW_CONDITION_SCORES
) {
  const scoresByCondition = scoresLookup[habitatType]
  if (!scoresByCondition) {
    return []
  }
  const out = []
  for (const [condition, score] of Object.entries(scoresByCondition)) {
    if (score !== NOT_POSSIBLE) {
      out.push({ condition, score })
    }
  }
  return out
}

export {
  tradingRulesByDistinctiveness,
  getHabitatsByBroad,
  getAreaBroadHabitats,
  getAreaHabitatTypes,
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType,
  getHedgerowHabitatTypes,
  getConditionsForHedgerowType,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_CONDITION_SCORES
}
