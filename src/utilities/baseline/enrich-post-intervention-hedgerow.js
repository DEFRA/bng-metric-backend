import {
  BaselineLookupError,
  calculateHedgerowBaseline,
  calculateRetainedHedgerowPostIntervention,
  calculateCreatedHedgerowPostIntervention,
  calculateEnhancedHedgerowPostIntervention
} from 'bng-metric-engine'

import { normalizeConditionForEngine } from './enrich-baseline-units.js'
import { lookupBaselineLinearLength } from './baseline-linear-length-by-ref.js'
import { METRES_PER_KM } from './enrich-units-shared.js'
import {
  isPresentEngineString,
  hasPositiveLinearSize,
  normaliseRetentionCategory,
  applyProposedResult,
  finalizePostInterventionFeatureStatus,
  handleLostLinearCategory,
  runProposedCalculation,
  skipUnrecognisedRetentionCategory,
  LOG_ENRICH_PI_PREFIX,
  RETENTION_RETAINED,
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  skipProposedEnrichment
} from './enrich-post-intervention-shared.js'

// ---------------------------------------------------------------------------
// Baseline-side linear enrichment (informational scores only)
// ---------------------------------------------------------------------------

/**
 * Enrich the baseline sub-object of a linear feature with distinctiveness
 * and condition scores. Does not set units or status — those are driven by
 * the proposed-side enrichment.
 *
 * @param {object} feature
 * @param {object} config
 * @param {string} config.layerLabel
 * @param {(lengthKm: number, type: string, condition: string, ctx: object) => object} config.calculate
 * @param {{ warn: (msg: string) => void }} config.logger
 * @param {(result: object) => Record<string, unknown>} [config.mapExtraFields]
 */
function enrichLinearBaselineSide(feature, config) {
  const subObject = feature.baseline
  const type = subObject?.type
  const condition = normalizeConditionForEngine(subObject?.condition)

  if (
    !isPresentEngineString(type) ||
    !isPresentEngineString(condition) ||
    !hasPositiveLinearSize(feature.sizeMetres)
  ) {
    return
  }

  feature.length = Math.round(feature.sizeMetres)
  const lengthKm = feature.length / METRES_PER_KM

  try {
    const result = config.calculate(lengthKm, type, condition, {
      feature,
      logger: config.logger
    })
    const extraFields = config.mapExtraFields?.(result) ?? {}
    subObject.distinctiveness = result.distinctiveness
    subObject.distinctivenessScore = result.distinctivenessScore
    subObject.conditionScore = result.conditionScore
    Object.assign(subObject, extraFields)
  } catch (error) {
    if (error instanceof BaselineLookupError) {
      config.logger.warn(
        `${LOG_ENRICH_PI_PREFIX}${config.layerLabel} featureId ${feature.featureId ?? 'unknown'}: ${error.message}`
      )
    } else {
      throw error
    }
  }
}

const HEDGEROW_PROPOSED_LABEL = 'Post-intervention hedgerow proposed'

// ---------------------------------------------------------------------------
// Exported hedgerow enrichment functions
// ---------------------------------------------------------------------------

/**
 * Enrich the `baseline` sub-object of a hedgerow with informational scores.
 *
 * @param {object} hedgerow
 * @param {{ warn: (msg: string) => void }} logger
 */
export function enrichPostInterventionHedgerowBaselineSide(hedgerow, logger) {
  enrichLinearBaselineSide(hedgerow, {
    logger,
    layerLabel: 'Post-intervention hedgerow baseline',
    calculate: (lengthKm, type, condition) =>
      calculateHedgerowBaseline(lengthKm, type, condition)
  })
}

/** @returns {(() => object) | null} */
function buildRetainedHedgerowCalculate(
  hedgerow,
  baseline,
  baselineCondition,
  lengthKm,
  logger
) {
  if (
    !isPresentEngineString(baseline.type) ||
    !isPresentEngineString(baselineCondition)
  ) {
    skipProposedEnrichment(
      hedgerow,
      HEDGEROW_PROPOSED_LABEL,
      'baseline type or condition is missing',
      logger
    )
    return null
  }
  return () =>
    calculateRetainedHedgerowPostIntervention(
      lengthKm,
      baseline.type,
      baselineCondition
    )
}

/** @returns {(() => object) | null} */
function buildCreatedHedgerowCalculate(
  hedgerow,
  proposed,
  proposedCondition,
  lengthKm,
  advanceYears,
  delayYears,
  logger
) {
  if (
    !isPresentEngineString(proposed.type) ||
    !isPresentEngineString(proposedCondition)
  ) {
    skipProposedEnrichment(
      hedgerow,
      HEDGEROW_PROPOSED_LABEL,
      'proposed type or condition is missing',
      logger
    )
    return null
  }
  return () =>
    calculateCreatedHedgerowPostIntervention(
      lengthKm,
      proposed.type,
      proposedCondition,
      advanceYears,
      delayYears
    )
}

/** @returns {(() => object) | null} */
function buildEnhancedHedgerowCalculate(
  hedgerow,
  baseline,
  proposed,
  baselineCondition,
  proposedCondition,
  lengthKm,
  { advanceYears, delayYears, baselineLengthByRef, logger }
) {
  if (
    !isPresentEngineString(baseline.type) ||
    !isPresentEngineString(proposed.type) ||
    !isPresentEngineString(baselineCondition) ||
    !isPresentEngineString(proposedCondition)
  ) {
    skipProposedEnrichment(
      hedgerow,
      HEDGEROW_PROPOSED_LABEL,
      'baseline or proposed type/condition is missing',
      logger
    )
    return null
  }
  return () => {
    const baselineLengthKm = lookupBaselineLinearLength(
      hedgerow.ref,
      baselineLengthByRef,
      'hedgerow'
    )
    return calculateEnhancedHedgerowPostIntervention(
      baselineLengthKm,
      lengthKm,
      baseline.type,
      proposed.type,
      baselineCondition,
      proposedCondition,
      { advanceYears, delayYears }
    )
  }
}

/**
 * @param {object} hedgerow
 * @returns {{
 *   baseline: object,
 *   proposed: object,
 *   category: string | null,
 *   baselineCondition: string,
 *   proposedCondition: string,
 *   advanceYears: number,
 *   delayYears: number,
 *   lengthKm: number
 * }}
 */
function prepareHedgerowProposedContext(hedgerow) {
  hedgerow.length = Math.round(hedgerow.sizeMetres)
  const baseline = hedgerow.baseline ?? {}
  const proposed = hedgerow.proposed ?? {}
  return {
    baseline,
    proposed,
    category: normaliseRetentionCategory(baseline.retentionCategory),
    baselineCondition: normalizeConditionForEngine(baseline.condition),
    proposedCondition: normalizeConditionForEngine(proposed.condition),
    advanceYears: proposed.advanceYears ?? 0,
    delayYears: proposed.delayYears ?? 0,
    lengthKm: hedgerow.length / METRES_PER_KM
  }
}

/**
 * @param {object} hedgerow
 * @param {ReturnType<typeof prepareHedgerowProposedContext>} ctx
 * @param {{ warn: (msg: string) => void }} logger
 * @param {Map<string, number> | undefined} baselineLengthByRef
 * @returns {(() => object) | null}
 */
function resolveHedgerowProposedCalculate(
  hedgerow,
  ctx,
  logger,
  baselineLengthByRef
) {
  const {
    baseline,
    proposed,
    category,
    baselineCondition,
    proposedCondition,
    advanceYears,
    delayYears,
    lengthKm
  } = ctx

  if (category === RETENTION_RETAINED) {
    return buildRetainedHedgerowCalculate(
      hedgerow,
      baseline,
      baselineCondition,
      lengthKm,
      logger
    )
  }
  if (category === RETENTION_CREATED) {
    return buildCreatedHedgerowCalculate(
      hedgerow,
      proposed,
      proposedCondition,
      lengthKm,
      advanceYears,
      delayYears,
      logger
    )
  }
  if (category === RETENTION_ENHANCED) {
    return buildEnhancedHedgerowCalculate(
      hedgerow,
      baseline,
      proposed,
      baselineCondition,
      proposedCondition,
      lengthKm,
      { advanceYears, delayYears, baselineLengthByRef, logger }
    )
  }
  skipUnrecognisedRetentionCategory(
    hedgerow,
    category,
    baseline.retentionCategory,
    HEDGEROW_PROPOSED_LABEL,
    logger
  )
  return null
}

/**
 * Calculate and apply post-intervention units for the proposed side of a
 * hedgerow, dispatching on `baseline.retentionCategory`.
 *
 * @param {object} hedgerow
 * @param {{ warn: (msg: string) => void }} logger
 * @param {Map<string, number> | undefined} baselineLengthByRef
 */
export function enrichPostInterventionHedgerowProposedSide(
  hedgerow,
  logger,
  baselineLengthByRef
) {
  const baseline = hedgerow.baseline ?? {}
  const category = normaliseRetentionCategory(baseline.retentionCategory)
  if (handleLostLinearCategory(hedgerow, category)) {
    return
  }
  if (!hasPositiveLinearSize(hedgerow.sizeMetres)) {
    skipProposedEnrichment(
      hedgerow,
      HEDGEROW_PROPOSED_LABEL,
      'sizeMetres is missing or not positive',
      logger
    )
    return
  }
  const ctx = prepareHedgerowProposedContext(hedgerow)
  const calculate = resolveHedgerowProposedCalculate(
    hedgerow,
    ctx,
    logger,
    baselineLengthByRef
  )
  runProposedCalculation(
    hedgerow,
    calculate,
    applyProposedResult,
    HEDGEROW_PROPOSED_LABEL,
    logger
  )
}

/**
 * @param {object} hedgerow
 * @param {{ warn: (msg: string) => void }} logger
 * @param {Map<string, number> | undefined} [baselineLengthByRef]
 */
export function enrichPostInterventionHedgerowWithUnits(
  hedgerow,
  logger,
  baselineLengthByRef
) {
  enrichPostInterventionHedgerowBaselineSide(hedgerow, logger)
  enrichPostInterventionHedgerowProposedSide(
    hedgerow,
    logger,
    baselineLengthByRef
  )
  finalizePostInterventionFeatureStatus(hedgerow)
}

// Re-export so the enrich-baseline-side helper is accessible from tests or sub-modules
export { enrichLinearBaselineSide }
export { HABITAT_STATUS } from '../../services/baseline/calculate-habitat-statuses.js'
