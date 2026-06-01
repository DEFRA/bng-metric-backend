import {
  BaselineLookupError,
  calculateAreaHabitatBaseline,
  calculateHedgerowBaseline,
  calculateWatercourseBaseline,
  isRecognisedEncroachmentValue,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from 'bng-metric-engine'

import { HABITAT_STATUS } from '../../services/baseline/calculate-habitat-statuses.js'

const LOG_ENRICH_PREFIX = 'enrichBaseline: '

/** @type {{ warn: (msg: string) => void }} */
const NO_OP_LOGGER = { warn: () => {} }

/** `area` on persisted baselines is PostGIS size in m², rounded to the nearest integer. */
const SQ_METRES_PER_HECTARE = 10_000

/** Linear feature sizes are stored in metres; the engine expects kilometres. */
const METRES_PER_KM = 1000

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

/**
 * Documents the effective encroachment multiplier used when a value is absent
 * or unrecognised. Not applied in code directly — the engine applies multiplier
 * 1 when `null` is passed for an encroachment argument, and unrecognised values
 * are coerced to `null` by {@link coerceEncroachmentForBaseline}.
 */
const DEFAULT_ENCROACHMENT_MULTIPLIER = 1

/**
 * @param {object} feature
 * @param {string} condition
 * @returns {boolean}
 */
function isLinearFeatureReadyForEnrichment(feature, condition) {
  return (
    Boolean(condition) &&
    typeof feature.sizeMetres === 'number' &&
    Number.isFinite(feature.sizeMetres) &&
    feature.sizeMetres > 0 &&
    typeof feature.type === 'string' &&
    feature.type.length > 0
  )
}

/**
 * @param {object} feature
 * @returns {number} length in kilometres
 */
function setLengthAndGetKm(feature) {
  feature.length = Math.round(feature.sizeMetres)
  return feature.length / METRES_PER_KM
}

/**
 * @param {object} feature
 * @param {object} result
 * @param {Record<string, unknown>} [extraFields]
 */
function assignBaselineUnitFields(feature, result, extraFields = {}) {
  feature.distinctiveness = result.distinctiveness
  feature.distinctivenessScore = result.distinctivenessScore
  feature.conditionScore = result.conditionScore
  feature.units = result.units
  Object.assign(feature, extraFields)
}

/**
 * @param {() => object} calculate
 * @param {object} feature
 * @param {object} [options]
 * @param {{ warn: (msg: string) => void }} [options.logger]
 * @param {string} [options.layerLabel]
 * @param {(result: object) => Record<string, unknown>} [options.mapExtraFields]
 */
function enrichFeatureWithEngineCalculation(
  calculate,
  feature,
  {
    logger = NO_OP_LOGGER,
    layerLabel = 'feature',
    mapExtraFields = () => ({})
  } = {}
) {
  try {
    const result = calculate()
    assignBaselineUnitFields(feature, result, mapExtraFields(result))
    feature.status = HABITAT_STATUS.COMPLETE
  } catch (error) {
    if (!(error instanceof BaselineLookupError)) {
      throw error
    }
    feature.status = HABITAT_STATUS.INCOMPLETE
    const featureId = feature.featureId ?? 'unknown'
    logger.warn(
      `${LOG_ENRICH_PREFIX}${layerLabel} featureId ${featureId} could not be calculated: ${error.message}`
    )
  }
}

function calculateAreaHabitatWithCandidates(sizeHa, habitat, condition) {
  let lastError = null
  for (const engineType of engineHabitatTypeCandidates(habitat)) {
    try {
      return calculateAreaHabitatBaseline(sizeHa, engineType, condition)
    } catch (error) {
      if (!(error instanceof BaselineLookupError)) {
        throw error
      }
      lastError = error
    }
  }
  if (lastError) {
    throw lastError
  }
  throw new BaselineLookupError('Habitat type is empty or unrecognised')
}

function enrichHabitatParcelWithUnits(habitat, logger = NO_OP_LOGGER) {
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
  enrichFeatureWithEngineCalculation(
    () => calculateAreaHabitatWithCandidates(sizeHa, habitat, condition),
    habitat,
    { logger, layerLabel: 'Habitat parcel' }
  )
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatUnrecognisedEncroachmentValue(value) {
  if (typeof value === 'object') {
    // null is handled upstream by isRecognisedEncroachmentValue, so value is a non-null object here
    return JSON.stringify(value)
  }
  return String(value) // NOSONAR S6551 — typeof guard above proves value is a primitive
}

/**
 * @param {unknown} value
 * @param {Record<string, number>} lookupMap
 * @param {string} label
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {string | null}
 */
function coerceEncroachmentForBaseline(value, lookupMap, label, logger) {
  if (isRecognisedEncroachmentValue(value, lookupMap)) {
    return typeof value === 'string' ? value : null
  }
  logger.warn(
    `${LOG_ENRICH_PREFIX}unrecognised ${label} "${formatUnrecognisedEncroachmentValue(value)}" — defaulting encroachment multiplier to ${DEFAULT_ENCROACHMENT_MULTIPLIER}`
  )
  return null
}

/**
 * @param {object} feature
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {{ watercourseEncroachment: string | null, riparianEncroachment: string | null }}
 */
function resolvedWatercourseEncroachments(feature, logger) {
  return {
    watercourseEncroachment: coerceEncroachmentForBaseline(
      feature.watercourseEncroachment,
      WATERCOURSE_ENCROACHMENT_MULTIPLIER,
      'watercourse encroachment',
      logger
    ),
    riparianEncroachment: coerceEncroachmentForBaseline(
      feature.riparianEncroachment,
      WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
      'riparian encroachment',
      logger
    )
  }
}

/**
 * Enrich a hedgerow or watercourse feature with baseline units from the engine.
 *
 * @param {object} feature
 * @param {object} config
 * @param {(lengthKm: number, type: string, condition: string, context: { feature: object, logger: { warn: (msg: string) => void } }) => object} config.calculate
 *   Engine calculation function. Always receives `context` — hedgerow
 *   implementations can ignore it; watercourse implementations use it to
 *   resolve encroachment values from the feature and log warnings.
 * @param {{ warn: (msg: string) => void }} [config.logger]
 * @param {string} config.layerLabel
 * @param {(result: object) => Record<string, unknown>} [config.mapExtraFields]
 */
function enrichLinearFeatureWithUnits(
  feature,
  { calculate, logger = NO_OP_LOGGER, layerLabel, mapExtraFields = () => ({}) }
) {
  const condition = normalizeConditionForEngine(feature.condition)
  if (!isLinearFeatureReadyForEnrichment(feature, condition)) {
    return
  }

  const lengthKm = setLengthAndGetKm(feature)
  enrichFeatureWithEngineCalculation(
    () => calculate(lengthKm, feature.type, condition, { feature, logger }),
    feature,
    { logger, layerLabel, mapExtraFields }
  )
}

function createWatercourseEnrichmentConfig(logger) {
  return {
    logger,
    layerLabel: 'Watercourse',
    calculate: (lengthKm, type, condition, { feature, logger: log }) => {
      const encroachments = resolvedWatercourseEncroachments(feature, log)
      return calculateWatercourseBaseline(
        lengthKm,
        type,
        condition,
        encroachments.watercourseEncroachment,
        encroachments.riparianEncroachment
      )
    },
    mapExtraFields: (result) => ({
      waterEncroachmentMultiplier: result.waterEncroachmentMultiplier,
      riparianEncroachmentMultiplier: result.riparianEncroachmentMultiplier
    })
  }
}

/**
 * Mutates `baselineDocument`: for each habitat parcel with a non-empty type,
 * condition, and positive finite `area` (m²), sets `distinctiveness`,
 * `distinctivenessScore`, `conditionScore`, and `units` from the engine. For
 * each hedgerow and watercourse feature with a non-empty type, condition, and
 * positive finite `sizeMetres`, sets the same fields (watercourses also get
 * `waterEncroachmentMultiplier` and `riparianEncroachmentMultiplier`). Rows
 * that lack required fields keep their extracted attributes and do not get
 * a `units` field. Rows where the engine rejects a lookup get
 * `status: 'Incomplete'` and a warning is logged. Always sets
 * `baselineDocument.units` totals afterward.
 *
 * @param {{ habitats?: object[], hedgerows?: object[], watercourses?: object[] }} baselineDocument
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {typeof baselineDocument}
 */
export function enrichBaselineDocumentWithUnits(
  baselineDocument,
  logger = NO_OP_LOGGER
) {
  const habitats = baselineDocument?.habitats
  if (Array.isArray(habitats) && habitats.length > 0) {
    for (const habitat of habitats) {
      enrichHabitatParcelWithUnits(habitat, logger)
    }
  }

  const hedgerows = baselineDocument?.hedgerows
  if (Array.isArray(hedgerows) && hedgerows.length > 0) {
    for (const hedgerow of hedgerows) {
      enrichLinearFeatureWithUnits(hedgerow, {
        logger,
        layerLabel: 'Hedgerow',
        calculate: (lengthKm, type, condition) =>
          calculateHedgerowBaseline(lengthKm, type, condition)
      })
    }
  }

  const watercourses = baselineDocument?.watercourses
  if (Array.isArray(watercourses) && watercourses.length > 0) {
    const watercourseConfig = createWatercourseEnrichmentConfig(logger)
    for (const watercourse of watercourses) {
      enrichLinearFeatureWithUnits(watercourse, watercourseConfig)
    }
  }

  summarizeBaselineUnitsTotals(baselineDocument)
  return baselineDocument
}
