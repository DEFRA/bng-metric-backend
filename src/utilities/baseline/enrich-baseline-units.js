import { calculateAreaHabitatBaseline } from 'bng-metric-engine'

/** `area` on persisted baselines is PostGIS size in m², rounded to the nearest integer. */
const SQ_METRES_PER_HECTARE = 10_000

/**
 * QGIS / statutory tool condition labels are often prefixed with an index
 * (e.g. `"6. N/A - Other"`). Engine keys use the suffix only (`"N/A - Other"`).
 */
export function normalizeConditionForEngine(condition) {
  if (typeof condition !== 'string') {
    return ''
  }
  return condition.trim().replace(/^\d+\.\s+/u, '')
}

/**
 * Engine habitat keys usually match `Baseline Habitat Type`, but some rows use
 * `{Broad} - {Habitat}` while GeoPackage stores them in separate columns.
 *
 * @param {{ type?: unknown, broadType?: unknown }} habitat
 * @returns {Generator<string>}
 */
export function* engineHabitatTypeCandidates(habitat) {
  const type = typeof habitat.type === 'string' ? habitat.type.trim() : ''
  if (!type) {
    return
  }
  yield type

  const broad =
    typeof habitat.broadType === 'string' ? habitat.broadType.trim() : ''

  if (broad) {
    const prefix = `${broad} - `
    if (!type.startsWith(prefix)) {
      yield `${broad} - ${type}`
    }
  }
}

/**
 * Sum `units` on features that have a finite numeric value (uncalculated rows are skipped).
 *
 * @param {object[] | undefined} features
 * @returns {number}
 */
export function sumFeatureBaselineUnits(features) {
  if (!Array.isArray(features)) {
    return 0
  }
  let total = 0
  for (const feature of features) {
    const units = feature?.units
    if (typeof units === 'number' && Number.isFinite(units)) {
      total += units
    }
  }
  return total
}

/**
 * Sets `baselineDocument.units` with cumulative baseline units per layer and overall.
 * Hedgerow and watercourse per-feature units are not calculated yet; totals are 0 until then.
 *
 * @param {{ habitats?: object[], hedgerows?: object[], watercourses?: object[] }} baselineDocument
 * @returns {typeof baselineDocument}
 */
export function summarizeBaselineUnitsTotals(baselineDocument) {
  const habitatsTotal = sumFeatureBaselineUnits(baselineDocument?.habitats)
  const hedgerowsTotal = sumFeatureBaselineUnits(baselineDocument?.hedgerows)
  const watercoursesTotal = sumFeatureBaselineUnits(
    baselineDocument?.watercourses
  )
  const totalUnits = habitatsTotal + hedgerowsTotal + watercoursesTotal

  baselineDocument.units = {
    totalUnits,
    habitatsTotal,
    hedgerowsTotal,
    watercoursesTotal
  }
  return baselineDocument
}

function enrichHabitatParcelWithUnits(habitat) {
  const condition = normalizeConditionForEngine(habitat.condition)
  const { area } = habitat

  if (
    !condition ||
    typeof area !== 'number' ||
    !Number.isFinite(area) ||
    area <= 0
  ) {
    return
  }

  const sizeHa = area / SQ_METRES_PER_HECTARE
  let result = null
  for (const engineType of engineHabitatTypeCandidates(habitat)) {
    try {
      result = calculateAreaHabitatBaseline(sizeHa, engineType, condition)
      break
    } catch {
      // Try next habitat label variant
    }
  }
  if (result !== null) {
    habitat.distinctiveness = result.distinctiveness
    habitat.distinctivenessScore = result.distinctivenessScore
    habitat.units = result.units
  }
}

/**
 * Mutates `baselineDocument.habitats`: for each parcel with a non-empty type and
 * condition and a positive finite `area` (m²), sets `distinctiveness`, `distinctivenessScore`
 * and `units` from {@link calculateAreaHabitatBaseline} (size in hectares).
 * Rows that lack required fields or are rejected by the engine keep their extracted
 * attributes and do not get a `units` field. Always sets `baselineDocument.units` totals afterward.
 *
 * @param {{ habitats?: object[] }} baselineDocument - Return value `document` from `extractBaseline`
 * @returns {typeof baselineDocument}
 */
export function enrichBaselineDocumentWithUnits(baselineDocument) {
  const habitats = baselineDocument?.habitats
  if (Array.isArray(habitats) && habitats.length > 0) {
    for (const habitat of habitats) {
      enrichHabitatParcelWithUnits(habitat)
    }
  }

  summarizeBaselineUnitsTotals(baselineDocument)
  return baselineDocument
}
