// Shared constants, guards, and result-application helpers used across the
// post-intervention enrichment sub-modules.

import {
  isRecognisedStrategicSignificance,
  resolveStrategicSignificance
} from 'bng-library/metric'

import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'
import { copyProposedEngineMetrics } from '../shared/proposed-enrichment-fields.js'
import { applyProposedTimeDifficultyDisplayFields } from './proposed-time-difficulty-display.js'
import {
  GPKG_RETENTION_LOST,
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  resolveRetentionCategory
} from './retention-category.js'
import { pricedAreaHectares } from '../shared/enrich-units-shared.js'

export { isPresentEngineString } from '../shared/is-present-engine-string.js'
export {
  normaliseRetentionCategory,
  resolveRetentionCategory,
  isLegacyLostLinear,
  deriveRetentionCategory,
  isLostRetentionCategory,
  RETENTION_CATEGORY_VALUES,
  RETENTION_RETAINED,
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  GPKG_RETENTION_LOST
} from './retention-category.js'

export const LOG_ENRICH_PI_PREFIX = 'enrichPostIntervention: '

/**
 * @param {unknown} sizeMetres
 * @returns {boolean}
 */
export function hasPositiveLinearSize(sizeMetres) {
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
export function hasValidAreaHabitatSize(habitat) {
  return pricedAreaHectares(habitat) !== null
}

// ---------------------------------------------------------------------------
// Result field helpers
// ---------------------------------------------------------------------------

/**
 * A Lost linear feature (hedgerow/watercourse) has no post-intervention habitat
 * where the baseline feature is removed, so it contributes 0 units and is
 * Complete. Area Lost parcels differ: they carry a proposed habitat and are
 * dispatched to the Created calculator instead.
 *
 * @param {object} feature
 */
export function applyLostLinearResult(feature) {
  feature.units = 0
  feature.status = HABITAT_STATUS.COMPLETE
}

/**
 * Enforce the invariant that a Complete feature always has numeric units: if
 * the proposed side could not calculate units, leave the feature Incomplete.
 *
 * @param {object} feature
 */
export function finalizePostInterventionFeatureStatus(feature) {
  if (typeof feature.units !== 'number' || !Number.isFinite(feature.units)) {
    feature.status = HABITAT_STATUS.INCOMPLETE
  }
}

/**
 * Apply a retained/created/enhanced engine result to the proposed sub-object.
 * Handles both standard result shapes (retained/created: `distinctiveness` etc.)
 * and enhanced shapes (`postInterventionDistinctiveness` etc.).
 *
 * @param {object} feature
 * @param {object} result
 */
export function applyProposedResult(feature, result) {
  const proposed = feature.proposed
  proposed.distinctiveness =
    result.distinctiveness ?? result.postInterventionDistinctiveness ?? null
  proposed.distinctivenessScore =
    result.distinctivenessScore ??
    result.postInterventionDistinctivenessScore ??
    null
  proposed.conditionScore =
    result.conditionScore ?? result.postInterventionConditionScore ?? null
  copyProposedEngineMetrics(proposed, result)
  applyProposedTimeDifficultyDisplayFields(proposed)
  feature.units = result.units
  feature.status = HABITAT_STATUS.COMPLETE
}

/**
 * Like `applyProposedResult` but also writes watercourse encroachment multipliers.
 * Enhanced results use `postIntervention*` prefixed field names.
 *
 * @param {object} watercourse
 * @param {object} result
 */
export function applyProposedWatercourseResult(watercourse, result) {
  applyProposedResult(watercourse, result)
  const proposed = watercourse.proposed
  proposed.waterEncroachmentMultiplier =
    result.waterEncroachmentMultiplier ??
    result.postInterventionWaterEncroachmentMultiplier ??
    null
  proposed.riparianEncroachmentMultiplier =
    result.riparianEncroachmentMultiplier ??
    result.postInterventionRiparianEncroachmentMultiplier ??
    null
}

/**
 * @param {object} feature
 * @param {string | null} category
 * @returns {boolean} true when Lost was handled
 */
export function handleLostLinearCategory(feature, category) {
  if (category === GPKG_RETENTION_LOST) {
    applyLostLinearResult(feature)
    return true
  }
  return false
}

/**
 * @param {object} feature
 * @param {string | null} category
 * @param {string | null | undefined} rawValue
 * @param {string} context
 * @param {{ warn: (msg: string) => void }} logger
 */
export function skipUnrecognisedRetentionCategory(
  feature,
  category,
  rawValue,
  context,
  logger
) {
  skipProposedEnrichment(
    feature,
    context,
    `unrecognised retention category "${category ?? rawValue}"`,
    logger
  )
}

/**
 * @param {object} feature
 * @param {(() => object) | null} calculate
 * @param {(feature: object, result: object) => void} applyResult
 * @param {string} context
 * @param {{ warn: (msg: string) => void }} logger
 */
export function runProposedCalculation(
  feature,
  calculate,
  applyResult,
  context,
  logger
) {
  if (calculate === null) {
    return
  }
  try {
    applyResult(feature, calculate())
  } catch (err) {
    handleProposedEnrichmentError(err, feature, context, logger)
  }
}

/**
 * Degrade a single feature gracefully when the engine cannot calculate its
 * units: mark it Incomplete and log a warning rather than re-throwing, so one
 * bad feature never aborts the whole post-intervention upload.
 *
 * @param {Error} error
 * @param {object} feature
 * @param {string} context
 * @param {{ warn: (msg: string) => void }} logger
 */
export function handleProposedEnrichmentError(error, feature, context, logger) {
  feature.status = HABITAT_STATUS.INCOMPLETE
  logger.warn(
    `${LOG_ENRICH_PI_PREFIX}${context} featureId ${feature.featureId ?? 'unknown'}: ${error.message}`
  )
}

/**
 * Log when proposed-side enrichment is skipped due to missing or invalid inputs.
 *
 * @param {object} feature
 * @param {string} context
 * @param {string} reason
 * @param {{ warn: (msg: string) => void }} logger
 */
export function skipProposedEnrichment(feature, context, reason, logger) {
  logger.warn(
    `${LOG_ENRICH_PI_PREFIX}${context} featureId ${feature.featureId ?? 'unknown'}: skipped proposed enrichment — ${reason}`
  )
}

/**
 * The strategic significance categories a created or enhanced habitat may
 * carry (BMD-1051): Low (×1) or High (×1.15). Medium (×1.10) is not supported
 * by the service. Retained habitats carry their baseline value, fixed at Low.
 */
export const VALID_PROPOSED_STRATEGIC_SIGNIFICANCE_CATEGORIES = Object.freeze([
  'Low',
  'High'
])

const INVALID_STRATEGIC_SIGNIFICANCE_UNITS = 0

/**
 * What the engine derives when it prices a proposed side. A rejected feature
 * isn't priced, so none of these may survive from an earlier pricing (of a
 * project saved before BMD-1051, or of the habitat it was before a re-type).
 * `advanceOrDelay` isn't here: it restates what the user entered.
 */
const ENGINE_DERIVED_PROPOSED_FIELDS = Object.freeze([
  'distinctiveness',
  'distinctivenessScore',
  'conditionScore',
  'timeMultiplier',
  'difficultyMultiplier',
  'difficulty',
  'standardTimeToTargetCondition',
  'finalTimeToTargetCondition'
])

/** The `event` field of the warning logged for each rejected value. */
export const STRATEGIC_SIGNIFICANCE_INVALID_EVENT =
  'strategic-significance-invalid'

/**
 * Why an imported Proposed Strategic Significance was rejected, as a log field
 * so the cases can be counted apart: Medium is a value the metric's own
 * drop-down offers, so a run of `medium` rejections says users are following
 * the metric rather than mistyping.
 */
export const INVALID_STRATEGIC_SIGNIFICANCE_REASON = Object.freeze({
  BLANK: 'blank',
  MEDIUM: 'medium',
  UNRECOGNISED: 'unrecognised'
})

/** The metric's labels for Medium, normalised as `strategicSignificanceReason` does. */
const MEDIUM_STRATEGIC_SIGNIFICANCE_LABELS = Object.freeze([
  'location ecologically desirable but not in local strategy',
  'medium',
  'medium strategic significance'
])

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isBlankStrategicSignificance(value) {
  return typeof value !== 'string' || value.trim() === ''
}

/**
 * @param {unknown} value an invalid Proposed Strategic Significance
 * @returns {string} one of INVALID_STRATEGIC_SIGNIFICANCE_REASON
 */
function strategicSignificanceReason(value) {
  if (isBlankStrategicSignificance(value)) {
    return INVALID_STRATEGIC_SIGNIFICANCE_REASON.BLANK
  }
  const normalised = value.trim().toLowerCase().replaceAll(/\s+/g, ' ')
  return MEDIUM_STRATEGIC_SIGNIFICANCE_LABELS.includes(normalised)
    ? INVALID_STRATEGIC_SIGNIFICANCE_REASON.MEDIUM
    : INVALID_STRATEGIC_SIGNIFICANCE_REASON.UNRECOGNISED
}

/**
 * Whether an imported Proposed Strategic Significance is one the service
 * accepts: present, recognised by the engine, and resolving to Low or High.
 * The category check is what rejects Medium while the pinned bng-library still
 * lists it; once bng-library's reference data drops Medium, its
 * `isValidProposedStrategicSignificance` says the same thing.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidProposedStrategicSignificance(value) {
  if (isBlankStrategicSignificance(value)) {
    return false
  }
  if (!isRecognisedStrategicSignificance(value)) {
    return false
  }
  const { strategicSignificanceCategory } = resolveStrategicSignificance(value)
  return VALID_PROPOSED_STRATEGIC_SIGNIFICANCE_CATEGORIES.includes(
    strategicSignificanceCategory
  )
}

/**
 * Persist a created or enhanced feature whose Proposed Strategic Significance
 * is invalid (BMD-1051 AC4): the value is nulled, nothing resolves from it, and
 * the units are zero by definition. Whatever an earlier pricing derived (see
 * ENGINE_DERIVED_PROPOSED_FIELDS) is cleared with it. The feature is saved
 * Incomplete so it can be highlighted. Choosing a valid value on habitat
 * details comes in a follow-up story; until then, re-uploading the file is the
 * only fix.
 *
 * The value that was rejected is kept in `rejectedStrategicSignificance`, so
 * nulling it loses nothing. That matters because a baseline edit re-prices
 * every created and enhanced feature (`rederivePostInterventionFromBaseline`),
 * so a project saved before BMD-1051 with Medium or blank reaches here through
 * an edit to another feature. A re-run, where the value is already null,
 * keeps what was recorded first.
 *
 * @param {object} feature
 * @param {unknown} value the Proposed Strategic Significance that was rejected
 */
export function applyInvalidStrategicSignificanceResult(feature, value) {
  feature.proposed ??= {}
  feature.proposed.rejectedStrategicSignificance = isBlankStrategicSignificance(
    value
  )
    ? (feature.proposed.rejectedStrategicSignificance ?? null)
    : value
  for (const field of ENGINE_DERIVED_PROPOSED_FIELDS) {
    feature.proposed[field] = null
  }
  feature.proposed.strategicSignificance = null
  feature.proposed.strategicSignificanceCategory = null
  feature.proposed.strategicSignificanceScore = null
  feature.units = INVALID_STRATEGIC_SIGNIFICANCE_UNITS
  feature.status = HABITAT_STATUS.INCOMPLETE
}

/**
 * Check the Proposed Strategic Significance of a created or enhanced feature
 * that has no valid size. Such a feature is skipped before the builders that
 * check it, so this is where an invalid value is nulled and priced at zero
 * (BMD-1051 AC4) instead. Other categories carry no proposed value to check.
 *
 * @param {object} feature
 * @param {string} context - e.g. "Habitat parcel"
 * @param {{ warn: (fields: object, msg: string) => void }} logger
 */
export function checkStrategicSignificanceOfUnsizedFeature(
  feature,
  context,
  logger
) {
  const category = resolveRetentionCategory(feature)
  if (category === RETENTION_CREATED || category === RETENTION_ENHANCED) {
    resolveProposedStrategicSignificance(feature, context, logger)
  }
}

/**
 * The Proposed Strategic Significance to hand the engine for a created or
 * enhanced feature, or `null` when the imported value is not valid. In that
 * case the invalid result has already been applied to the feature (see
 * `applyInvalidStrategicSignificanceResult`) and the caller must not price it.
 *
 * The rejection is logged as a structured warning, `event`
 * `strategic-significance-invalid`, with the layer, feature id, parcel ref,
 * the raw value and the reason, so the cases can be counted in the log
 * platform. The pino logger carries the request context (and so the upload or
 * edit it came from); a bare string logger gets the message alone.
 *
 * @param {object} feature
 * @param {string} context - e.g. "Habitat parcel"
 * @param {{ warn: (fields: object, msg: string) => void }} logger
 * @returns {string | null}
 */
export function resolveProposedStrategicSignificance(feature, context, logger) {
  const value = feature.proposed?.strategicSignificance
  if (isValidProposedStrategicSignificance(value)) {
    if (feature.proposed.rejectedStrategicSignificance != null) {
      feature.proposed.rejectedStrategicSignificance = null
    }
    return value
  }
  const reason = strategicSignificanceReason(value)
  logger.warn(
    {
      event: STRATEGIC_SIGNIFICANCE_INVALID_EVENT,
      layer: context,
      featureId: feature.featureId ?? null,
      ref: feature.ref ?? null,
      value: value ?? null,
      reason
    },
    `${LOG_ENRICH_PI_PREFIX}${context} featureId ${feature.featureId ?? 'unknown'}: invalid proposed strategic significance ${JSON.stringify(value)} (${reason}) — nulled, units 0 (valid values: Low, High)`
  )
  applyInvalidStrategicSignificanceResult(feature, value)
  return null
}
