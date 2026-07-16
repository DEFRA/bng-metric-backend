import {
  calculateWatercourseBaseline,
  calculateRetainedWatercoursePostIntervention,
  calculateCreatedWatercoursePostIntervention,
  calculateEnhancedWatercoursePostIntervention
} from 'bng-metric-engine'

import {
  normalizeConditionForEngine,
  resolvedWatercourseEncroachments
} from './enrich-baseline-units.js'
import { lookupBaselineLinearLength } from './baseline-linear-length-by-ref.js'
import { METRES_PER_KM } from './enrich-units-shared.js'
import {
  isPresentEngineString,
  hasPositiveLinearSize,
  applyProposedWatercourseResult,
  finalizePostInterventionFeatureStatus,
  handleLostLinearCategory,
  runProposedCalculation,
  skipUnrecognisedRetentionCategory,
  RETENTION_RETAINED,
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  resolveRetentionCategory,
  isLegacyLostLinear,
  GPKG_RETENTION_LOST,
  skipProposedEnrichment
} from './enrich-post-intervention-shared.js'
import { enrichLinearBaselineSide } from './enrich-post-intervention-hedgerow.js'

const WATERCOURSE_PROPOSED_LABEL = 'Post-intervention watercourse proposed'

// ---------------------------------------------------------------------------
// Exported watercourse enrichment functions
// ---------------------------------------------------------------------------

/**
 * Enrich the `baseline` sub-object of a watercourse with informational scores.
 *
 * @param {object} watercourse
 * @param {{ warn: (msg: string) => void }} logger
 */
export function enrichPostInterventionWatercourseBaselineSide(
  watercourse,
  logger
) {
  enrichLinearBaselineSide(watercourse, {
    logger,
    layerLabel: 'Post-intervention watercourse baseline',
    calculate: (lengthKm, type, condition, { feature, logger: log }) => {
      const subObject = feature.baseline
      const encroachments = resolvedWatercourseEncroachments(
        {
          watercourseEncroachment: subObject?.watercourseEncroachment,
          riparianEncroachment: subObject?.riparianEncroachment
        },
        log
      )
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
  })
}

/** @returns {(() => object) | null} */
function buildRetainedWatercourseCalculate(
  watercourse,
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
      watercourse,
      WATERCOURSE_PROPOSED_LABEL,
      'baseline type or condition is missing',
      logger
    )
    return null
  }
  return () =>
    calculateRetainedWatercoursePostIntervention(
      lengthKm,
      baseline.type,
      baselineCondition,
      baseline.watercourseEncroachment ?? null,
      baseline.riparianEncroachment ?? null
    )
}

/** @returns {(() => object) | null} */
function buildCreatedWatercourseCalculate(
  watercourse,
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
      watercourse,
      WATERCOURSE_PROPOSED_LABEL,
      'proposed type or condition is missing',
      logger
    )
    return null
  }
  return () =>
    calculateCreatedWatercoursePostIntervention(
      lengthKm,
      proposed.type,
      proposedCondition,
      proposed.watercourseEncroachment ?? null,
      proposed.riparianEncroachment ?? null,
      advanceYears,
      delayYears
    )
}

/** @returns {(() => object) | null} */
function buildEnhancedWatercourseCalculate(
  watercourse,
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
      watercourse,
      WATERCOURSE_PROPOSED_LABEL,
      'baseline or proposed type/condition is missing',
      logger
    )
    return null
  }
  return () => {
    const baselineLengthKm = lookupBaselineLinearLength(
      watercourse.ref,
      baselineLengthByRef,
      'watercourse'
    )
    return calculateEnhancedWatercoursePostIntervention(
      baselineLengthKm,
      lengthKm,
      baseline.type,
      proposed.type,
      baselineCondition,
      proposedCondition,
      {
        watercourseEncroachment: proposed.watercourseEncroachment ?? null,
        riparianEncroachment: proposed.riparianEncroachment ?? null,
        advanceYears,
        delayYears
      }
    )
  }
}

/**
 * @param {object} watercourse
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
function prepareWatercourseProposedContext(watercourse) {
  watercourse.length = Math.round(watercourse.sizeMetres)
  const baseline = watercourse.baseline ?? {}
  const proposed = watercourse.proposed ?? {}
  return {
    baseline,
    proposed,
    category: resolveRetentionCategory(watercourse),
    baselineCondition: normalizeConditionForEngine(baseline.condition),
    proposedCondition: normalizeConditionForEngine(proposed.condition),
    advanceYears: proposed.advanceYears ?? 0,
    delayYears: proposed.delayYears ?? 0,
    lengthKm: watercourse.length / METRES_PER_KM
  }
}

/**
 * @param {object} watercourse
 * @param {ReturnType<typeof prepareWatercourseProposedContext>} ctx
 * @param {Map<string, number> | undefined} baselineLengthByRef
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {(() => object) | null}
 */
function resolveWatercourseProposedCalculate(
  watercourse,
  ctx,
  baselineLengthByRef,
  logger
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
    return buildRetainedWatercourseCalculate(
      watercourse,
      baseline,
      baselineCondition,
      lengthKm,
      logger
    )
  }
  if (category === RETENTION_CREATED) {
    return buildCreatedWatercourseCalculate(
      watercourse,
      proposed,
      proposedCondition,
      lengthKm,
      advanceYears,
      delayYears,
      logger
    )
  }
  if (category === RETENTION_ENHANCED) {
    return buildEnhancedWatercourseCalculate(
      watercourse,
      baseline,
      proposed,
      baselineCondition,
      proposedCondition,
      lengthKm,
      { advanceYears, delayYears, baselineLengthByRef, logger }
    )
  }
  skipUnrecognisedRetentionCategory(
    watercourse,
    category,
    watercourse.retentionCategory ?? baseline.retentionCategory,
    WATERCOURSE_PROPOSED_LABEL,
    logger
  )
  return null
}

/**
 * Calculate and apply post-intervention units for the proposed side of a
 * watercourse, dispatching on `retentionCategory`.
 *
 * @param {object} watercourse
 * @param {Map<string, number> | undefined} baselineLengthByRef
 * @param {{ warn: (msg: string) => void }} logger
 */
export function enrichPostInterventionWatercourseProposedSide(
  watercourse,
  baselineLengthByRef,
  logger
) {
  if (isLegacyLostLinear(watercourse)) {
    handleLostLinearCategory(watercourse, GPKG_RETENTION_LOST)
    return
  }
  if (!hasPositiveLinearSize(watercourse.sizeMetres)) {
    skipProposedEnrichment(
      watercourse,
      WATERCOURSE_PROPOSED_LABEL,
      'sizeMetres is missing or not positive',
      logger
    )
    return
  }
  const ctx = prepareWatercourseProposedContext(watercourse)
  const calculate = resolveWatercourseProposedCalculate(
    watercourse,
    ctx,
    baselineLengthByRef,
    logger
  )
  runProposedCalculation(
    watercourse,
    calculate,
    applyProposedWatercourseResult,
    WATERCOURSE_PROPOSED_LABEL,
    logger
  )
}

/**
 * @param {object} watercourse
 * @param {{ warn: (msg: string) => void }} logger
 * @param {Map<string, number> | undefined} baselineLengthByRef
 */
export function enrichPostInterventionWatercourseWithUnits(
  watercourse,
  logger,
  baselineLengthByRef
) {
  enrichPostInterventionWatercourseBaselineSide(watercourse, logger)
  enrichPostInterventionWatercourseProposedSide(
    watercourse,
    baselineLengthByRef,
    logger
  )
  finalizePostInterventionFeatureStatus(watercourse)
}

// Export for potential test coverage
export { LOG_ENRICH_PI_PREFIX } from './enrich-post-intervention-shared.js'
