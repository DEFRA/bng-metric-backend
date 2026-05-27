// Reference data for the Habitat Details page (BMD-315): broad habitats,
// habitat types, conditions, and trading rules. Thin readers over
// bng-metric-engine's CONDITION_SCORES and DISTINCTIVENESS_SCORES so backend
// and engine cannot drift.

import { CONDITION_SCORES, DISTINCTIVENESS_SCORES } from 'bng-metric-engine'
import { distinctivenessByHabitatType } from './habitat-distinctiveness.js'

export { distinctivenessScores } from './habitat-distinctiveness.js'

const NOT_POSSIBLE = 'Not Possible'

// Trading rules sourced from the engine's "Suggested action" strings so the
// wording stays in lockstep with the calculator.
const tradingRulesByDistinctiveness = Object.fromEntries(
  Object.entries(DISTINCTIVENESS_SCORES).map(([band, entry]) => [
    band,
    entry['Suggested action']
  ])
)

// Habitat types whose distinctiveness band is one of these are shown in the
// Area Habitats dropdown. High and V.High are excluded because they cannot be
// selected in the area habitats journey.
const AREA_HABITAT_BANDS = new Set(['V.Low', 'Low', 'Medium'])

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
    if (areaOnly && !AREA_HABITAT_BANDS.has(distinctiveness)) {
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
 * habitats journey.
 *
 * @param {string} broadHabitat
 * @returns {string[]}
 */
function getAreaHabitatTypes(broadHabitat) {
  const types = []
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    if (row.broadHabitat === broadHabitat) {
      types.push(row.habitatType)
    }
  }
  return types.sort((a, b) => a.localeCompare(b))
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

export {
  tradingRulesByDistinctiveness,
  getHabitatsByBroad,
  getAreaBroadHabitats,
  getAreaHabitatTypes,
  getConditionsForHabitatType
}
