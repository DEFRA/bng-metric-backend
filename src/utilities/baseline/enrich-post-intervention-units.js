// Post-intervention unit enrichment: reads `baseline.*` and `proposed.*`
// sub-object fields and writes derived distinctiveness / conditionScore / units
// back into those sub-objects plus the top-level `units` and `status` on the
// proposed side. Top-level `units` always reflect proposed-side calculation.

import * as metricEngine from 'bng-metric-engine'

import { HABITAT_STATUS } from '../../services/baseline/calculate-habitat-statuses.js'
import {
  normalizeConditionForEngine,
  calculateAreaHabitatWithCandidates,
  resolvedWatercourseEncroachments
} from './enrich-baseline-units.js'
import { summarizeFeatureSetUnitsTotals } from '../features/feature-set-units.js'
import {
  SQ_METRES_PER_HECTARE,
  METRES_PER_KM,
  NO_OP_LOGGER,
  enrichCollectionIfNonEmpty
} from './enrich-units-shared.js'

const LOG_ENRICH_PI_PREFIX = 'enrichPostIntervention: '

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPresentEngineString(value) {
  if (typeof value !== 'string' || value === '') {
    return false
  } else {
    return value.trim().toUpperCase() !== 'N/A'
  }
}

/**
 * @param {unknown} sizeMetres
 * @returns {boolean}
 */
function hasPositiveLinearSize(sizeMetres) {
  return (
    typeof sizeMetres === 'number' &&
    Number.isFinite(sizeMetres) &&
    sizeMetres > 0
  )
}

/**
 * @param {object} habitat
 * @returns {boolean}
 */
function hasValidAreaHabitatSize(habitat) {
  const { area } = habitat
  return typeof area === 'number' && Number.isFinite(area) && area > 0
}

/**
 * Write engine results into a baseline or proposed sub-object. Top-level `units`
 * are updated only for the proposed side.
 *
 * @param {object} feature
 * @param {'baseline' | 'proposed'} side
 * @param {object} result
 * @param {Record<string, unknown>} [extraFields]
 */
function assignSideUnitFields(feature, side, result, extraFields = {}) {
  const subObject = feature[side]
  subObject.distinctiveness = result.distinctiveness
  subObject.distinctivenessScore = result.distinctivenessScore
  subObject.conditionScore = result.conditionScore
  Object.assign(subObject, extraFields)
  if (side === 'proposed') {
    feature.units = result.units
  } else {
    // baseline side: top-level units reflect proposed-side calculation only
  }
}

/**
 * @param {object} feature
 * @param {'baseline' | 'proposed'} side
 * @param {object} result
 * @param {Record<string, unknown>} extraFields
 */
function applyLinearSideResult(feature, side, result, extraFields) {
  assignSideUnitFields(feature, side, result, extraFields)
  if (side === 'proposed') {
    feature.status = HABITAT_STATUS.COMPLETE
  } else {
    // baseline side: status is driven by proposed-side enrichment
  }
}

/**
 * @param {Error} error
 * @param {object} feature
 * @param {'baseline' | 'proposed'} side
 * @param {(message: string) => void} warn
 */
function handleEnrichmentError(error, feature, side, warn) {
  if (error instanceof metricEngine.BaselineLookupError) {
    if (side === 'proposed') {
      feature.status = HABITAT_STATUS.INCOMPLETE
    } else {
      // baseline-side lookup failure: status is left unchanged
    }
    warn(error.message)
  } else {
    throw error
  }
}

/**
 * Enrich one side (`baseline` or `proposed`) of a post-intervention area habitat.
 *
 * @param {object} habitat
 * @param {'baseline' | 'proposed'} side
 * @param {{ warn: (msg: string) => void }} logger
 */
function enrichPostInterventionAreaSide(habitat, side, logger) {
  const subObject = habitat[side]
  const condition = normalizeConditionForEngine(subObject?.condition)

  if (condition && hasValidAreaHabitatSize(habitat)) {
    const sizeHa = habitat.area / SQ_METRES_PER_HECTARE
    const habitatProxy = {
      type: subObject?.type,
      broadType: subObject?.broadType
    }

    try {
      const result = calculateAreaHabitatWithCandidates(
        sizeHa,
        habitatProxy,
        condition
      )
      assignSideUnitFields(habitat, side, result)
      if (side === 'proposed') {
        habitat.status = HABITAT_STATUS.COMPLETE
      } else {
        // baseline side: status is driven by proposed-side enrichment
      }
    } catch (error) {
      handleEnrichmentError(error, habitat, side, (message) => {
        logger.warn(
          `${LOG_ENRICH_PI_PREFIX}Habitat parcel featureId ${habitat.featureId ?? 'unknown'} ${side} side: ${message}`
        )
      })
    }
  } else {
    // missing condition or area — skip enrichment for this side
  }
}

/**
 * Enrich one side (`baseline` or `proposed`) of a post-intervention linear
 * feature (hedgerow or watercourse).
 *
 * @param {object} feature
 * @param {'baseline' | 'proposed'} side
 * @param {object} config
 * @param {string} config.layerLabel
 * @param {(lengthKm: number, type: string, condition: string, ctx: object) => object} config.calculate
 * @param {{ warn: (msg: string) => void }} config.logger
 * @param {(result: object) => Record<string, unknown>} [config.mapExtraFields]
 */
function enrichPostInterventionLinearSide(feature, side, config) {
  const subObject = feature[side]
  const type = subObject?.type
  const condition = normalizeConditionForEngine(subObject?.condition)

  if (
    isPresentEngineString(type) &&
    isPresentEngineString(condition) &&
    hasPositiveLinearSize(feature.sizeMetres)
  ) {
    feature.length = Math.round(feature.sizeMetres)
    const lengthKm = feature.length / METRES_PER_KM

    try {
      const result = config.calculate(lengthKm, type, condition, {
        feature,
        side,
        logger: config.logger
      })
      const extraFields = config.mapExtraFields?.(result) ?? {}
      applyLinearSideResult(feature, side, result, extraFields)
    } catch (error) {
      handleEnrichmentError(error, feature, side, (message) => {
        config.logger.warn(
          `${LOG_ENRICH_PI_PREFIX}${config.layerLabel} featureId ${feature.featureId ?? 'unknown'}: ${message}`
        )
      })
    }
  } else {
    // missing type, condition, or size — skip enrichment for this side
  }
}

function enrichPostInterventionAreaHabitat(habitat, logger) {
  enrichPostInterventionAreaSide(habitat, 'proposed', logger)
  enrichPostInterventionAreaSide(habitat, 'baseline', logger)
}

function enrichPostInterventionHedgerowWithUnits(hedgerow, logger) {
  const hedgerowConfig = {
    logger,
    calculate: (lengthKm, type, condition) =>
      metricEngine.calculateHedgerowBaseline(lengthKm, type, condition)
  }
  enrichPostInterventionLinearSide(hedgerow, 'baseline', {
    ...hedgerowConfig,
    layerLabel: 'Post-intervention hedgerow baseline'
  })
  enrichPostInterventionLinearSide(hedgerow, 'proposed', {
    ...hedgerowConfig,
    layerLabel: 'Post-intervention hedgerow proposed'
  })
}

function createPostInterventionWatercourseSideConfig(logger, side) {
  return {
    logger,
    layerLabel: `Post-intervention watercourse ${side}`,
    calculate: (lengthKm, type, condition, { feature, logger: log }) => {
      const subObject = feature[side]
      const encroachments = resolvedWatercourseEncroachments(
        {
          watercourseEncroachment: subObject?.watercourseEncroachment,
          riparianEncroachment: subObject?.riparianEncroachment
        },
        log
      )
      return metricEngine.calculateWatercourseBaseline(
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

function enrichPostInterventionWatercourseWithUnits(watercourse, logger) {
  enrichPostInterventionLinearSide(
    watercourse,
    'baseline',
    createPostInterventionWatercourseSideConfig(logger, 'baseline')
  )
  enrichPostInterventionLinearSide(
    watercourse,
    'proposed',
    createPostInterventionWatercourseSideConfig(logger, 'proposed')
  )
}

/**
 * Mutates `postInterventionDocument`: for each feature, enriches the `proposed`
 * sub-object with `distinctiveness`, `distinctivenessScore`, `conditionScore`
 * and sets top-level `units` / `status` from bng-metric-engine. Also enriches
 * the `baseline` sub-object with distinctiveness/conditionScore (and watercourse
 * encroachment multipliers). Always sets `postInterventionDocument.units` totals
 * afterward.
 *
 * @param {{ habitats?: object[], hedgerows?: object[], watercourses?: object[] }} postInterventionDocument
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {typeof postInterventionDocument}
 */
export function enrichPostInterventionDocumentWithUnits(
  postInterventionDocument,
  logger = NO_OP_LOGGER
) {
  enrichCollectionIfNonEmpty(
    postInterventionDocument?.habitats,
    enrichPostInterventionAreaHabitat,
    logger
  )
  enrichCollectionIfNonEmpty(
    postInterventionDocument?.hedgerows,
    enrichPostInterventionHedgerowWithUnits,
    logger
  )
  enrichCollectionIfNonEmpty(
    postInterventionDocument?.watercourses,
    enrichPostInterventionWatercourseWithUnits,
    logger
  )

  summarizeFeatureSetUnitsTotals(postInterventionDocument)
  return postInterventionDocument
}
