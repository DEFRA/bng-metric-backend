// Shared constants, guards, and result-application helpers used across the
// post-intervention enrichment sub-modules.

import { HABITAT_STATUS } from '../../services/baseline/calculate-habitat-statuses.js'

export { isPresentEngineString } from './is-present-engine-string.js'

export const LOG_ENRICH_PI_PREFIX = 'enrichPostIntervention: '

export const RETENTION_RETAINED = 'Retained'
export const RETENTION_LOST = 'Lost'
export const RETENTION_ENHANCED = 'Enhanced'
export const RETENTION_CREATED = 'Created'

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
  const { area } = habitat
  return typeof area === 'number' && Number.isFinite(area) && area > 0
}

// ---------------------------------------------------------------------------
// Retention category normalisation
// ---------------------------------------------------------------------------

/**
 * @param {string} char
 * @returns {boolean}
 */
function isAsciiDigit(char) {
  return char >= '0' && char <= '9'
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isHorizontalWhitespace(char) {
  return char === ' ' || char === '\t'
}

/**
 * @param {string} text
 * @returns {number}
 */
function indexAfterLeadingDigits(text) {
  let index = 0
  while (index < text.length && isAsciiDigit(text[index])) {
    index += 1
  }
  return index
}

/**
 * @param {string} text
 * @param {number} startIndex
 * @returns {number}
 */
function indexAfterLeadingWhitespace(text, startIndex) {
  let index = startIndex
  while (index < text.length && isHorizontalWhitespace(text[index])) {
    index += 1
  }
  return index
}

/**
 * @param {string} text
 * @param {number} digitEnd
 * @returns {boolean}
 */
function hasNumericListPrefix(text, digitEnd) {
  if (digitEnd === 0) {
    return false
  }
  if (digitEnd >= text.length) {
    return false
  }
  return text[digitEnd] === '.'
}

/**
 * Strip a leading "N. " numeric list prefix from a retention category string
 * (e.g. "1. Created" → "Created"). Uses linear string parsing to avoid ReDoS.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normaliseRetentionCategory(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  const digitEnd = indexAfterLeadingDigits(trimmed)
  if (hasNumericListPrefix(trimmed, digitEnd)) {
    const contentStart = indexAfterLeadingWhitespace(trimmed, digitEnd + 1)
    return trimmed.slice(contentStart)
  }
  return trimmed
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
  if (result.timeMultiplier != null) {
    proposed.timeMultiplier = result.timeMultiplier
  }
  if (result.difficultyMultiplier != null) {
    proposed.difficultyMultiplier = result.difficultyMultiplier
  }
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
  if (category === RETENTION_LOST) {
    applyLostLinearResult(feature)
    return true
  }
  return false
}

/**
 * @param {object} feature
 * @param {string | null} category
 * @param {string | null | undefined} rawRetentionCategory
 * @param {string} context
 * @param {{ warn: (msg: string) => void }} logger
 */
export function skipUnrecognisedRetentionCategory(
  feature,
  category,
  rawRetentionCategory,
  context,
  logger
) {
  skipProposedEnrichment(
    feature,
    context,
    `unrecognised retention category "${category ?? rawRetentionCategory}"`,
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
