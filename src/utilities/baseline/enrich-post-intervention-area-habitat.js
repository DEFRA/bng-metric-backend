import {
  BaselineLookupError,
  calculateEnhancedAreaHabitatPostIntervention,
  calculateRetainedAreaHabitatPostIntervention,
  calculateCreatedAreaHabitatPostIntervention
} from 'bng-metric-engine'

import {
  normalizeConditionForEngine,
  engineHabitatTypeCandidates,
  calculateAreaHabitatWithCandidates
} from './enrich-baseline-units.js'
import { SQ_METRES_PER_HECTARE } from './enrich-units-shared.js'
import {
  hasValidAreaHabitatSize,
  applyProposedResult,
  finalizePostInterventionFeatureStatus,
  runProposedCalculation,
  skipUnrecognisedRetentionCategory,
  LOG_ENRICH_PI_PREFIX,
  RETENTION_RETAINED,
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  resolveRetentionCategory,
  skipProposedEnrichment
} from './enrich-post-intervention-shared.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a calculation and map BaselineLookupError to a return value rather than
 * nesting try/catch/if inside candidate loops (Sonar S134).
 *
 * @template T
 * @param {() => T} calculate
 * @returns {{ result: T } | { lookupError: BaselineLookupError }}
 */
function attemptBaselineLookupCalculation(calculate) {
  try {
    return { result: calculate() }
  } catch (err) {
    if (err instanceof BaselineLookupError) {
      return { lookupError: err }
    }
    throw err
  }
}

/**
 * Try each engine habitat-type candidate for a single-axis area-habitat call.
 *
 * @param {{ type?: string, broadType?: string }} habitatProxy
 * @param {(type: string) => object} calculate
 * @returns {object}
 */
function calculateAreaWithCandidates(habitatProxy, calculate) {
  let lastError = null
  for (const type of engineHabitatTypeCandidates(habitatProxy)) {
    const attempt = attemptBaselineLookupCalculation(() => calculate(type))
    if ('result' in attempt) {
      return attempt.result
    }
    lastError = attempt.lookupError
  }
  throw (
    lastError ??
    new BaselineLookupError('Habitat type is empty or unrecognised')
  )
}

/**
 * Try candidate strings for both baseline and proposed habitat types for
 * Enhanced area habitat calculations.
 *
 * @param {number} sizeHa
 * @param {{ type?: string, broadType?: string }} baselineProxy
 * @param {{ type?: string, broadType?: string }} proposedProxy
 * @param {string} baselineCondition
 * @param {string} proposedCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {object}
 */
function calculateEnhancedAreaWithCandidates(
  sizeHa,
  baselineProxy,
  proposedProxy,
  baselineCondition,
  proposedCondition,
  advanceYears,
  delayYears
) {
  let lastError = null
  for (const baseType of engineHabitatTypeCandidates(baselineProxy)) {
    for (const postType of engineHabitatTypeCandidates(proposedProxy)) {
      const attempt = attemptBaselineLookupCalculation(() =>
        calculateEnhancedAreaHabitatPostIntervention(
          sizeHa,
          baseType,
          postType,
          baselineCondition,
          proposedCondition,
          advanceYears,
          delayYears
        )
      )
      if ('result' in attempt) {
        return attempt.result
      }
      lastError = attempt.lookupError
    }
  }
  throw (
    lastError ??
    new BaselineLookupError('Habitat type is empty or unrecognised')
  )
}

const AREA_PROPOSED_LABEL = 'Habitat parcel'

// ---------------------------------------------------------------------------
// Exported enrichment functions
// ---------------------------------------------------------------------------

/**
 * Enrich the `baseline` sub-object with informational scores using the
 * area-habitat baseline calculator.
 *
 * @param {object} habitat
 * @param {{ warn: (msg: string) => void }} logger
 */
export function enrichPostInterventionAreaBaselineSide(habitat, logger) {
  const baseline = habitat.baseline
  const condition = normalizeConditionForEngine(baseline?.condition)
  if (!condition || !hasValidAreaHabitatSize(habitat)) {
    return
  }
  const sizeHa = habitat.area / SQ_METRES_PER_HECTARE
  try {
    const result = calculateAreaHabitatWithCandidates(
      sizeHa,
      { type: baseline?.type, broadType: baseline?.broadType },
      condition
    )
    baseline.distinctiveness = result.distinctiveness
    baseline.distinctivenessScore = result.distinctivenessScore
    baseline.conditionScore = result.conditionScore
  } catch (err) {
    if (err instanceof BaselineLookupError) {
      logger.warn(
        `${LOG_ENRICH_PI_PREFIX}Habitat parcel featureId ${habitat.featureId ?? 'unknown'} baseline side: ${err.message}`
      )
    } else {
      throw err
    }
  }
}

/** @returns {(() => object) | null} */
function buildRetainedAreaCalculate(
  habitat,
  baseline,
  baselineCondition,
  sizeHa,
  logger
) {
  if (!baselineCondition) {
    skipProposedEnrichment(
      habitat,
      AREA_PROPOSED_LABEL,
      'baseline condition is missing',
      logger
    )
    return null
  }
  return () =>
    calculateAreaWithCandidates(
      { type: baseline.type, broadType: baseline.broadType },
      (type) =>
        calculateRetainedAreaHabitatPostIntervention(
          sizeHa,
          type,
          baselineCondition
        )
    )
}

/** @returns {(() => object) | null} */
function buildCreatedAreaCalculate(
  habitat,
  proposed,
  proposedCondition,
  sizeHa,
  advanceYears,
  delayYears,
  logger
) {
  if (!proposedCondition) {
    skipProposedEnrichment(
      habitat,
      AREA_PROPOSED_LABEL,
      'proposed condition is missing',
      logger
    )
    return null
  }
  return () =>
    calculateAreaWithCandidates(
      { type: proposed.type, broadType: proposed.broadType },
      (type) =>
        calculateCreatedAreaHabitatPostIntervention(
          sizeHa,
          type,
          proposedCondition,
          advanceYears,
          delayYears
        )
    )
}

/** @returns {(() => object) | null} */
function buildEnhancedAreaCalculate(
  habitat,
  baseline,
  proposed,
  baselineCondition,
  proposedCondition,
  sizeHa,
  { advanceYears, delayYears, logger }
) {
  if (!baselineCondition || !proposedCondition) {
    skipProposedEnrichment(
      habitat,
      AREA_PROPOSED_LABEL,
      'baseline or proposed condition is missing',
      logger
    )
    return null
  }
  return () =>
    calculateEnhancedAreaWithCandidates(
      sizeHa,
      { type: baseline.type, broadType: baseline.broadType },
      { type: proposed.type, broadType: proposed.broadType },
      baselineCondition,
      proposedCondition,
      advanceYears,
      delayYears
    )
}

/**
 * @param {object} habitat
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {(() => object) | null}
 */
function resolveAreaProposedCalculate(habitat, logger) {
  const sizeHa = habitat.area / SQ_METRES_PER_HECTARE
  const baseline = habitat.baseline ?? {}
  const proposed = habitat.proposed ?? {}
  const baselineCondition = normalizeConditionForEngine(baseline.condition)
  const proposedCondition = normalizeConditionForEngine(proposed.condition)
  const advanceYears = proposed.advanceYears ?? 0
  const delayYears = proposed.delayYears ?? 0
  const category = resolveRetentionCategory(habitat)

  if (category === RETENTION_RETAINED) {
    return buildRetainedAreaCalculate(
      habitat,
      baseline,
      baselineCondition,
      sizeHa,
      logger
    )
  }
  if (category === RETENTION_CREATED) {
    return buildCreatedAreaCalculate(
      habitat,
      proposed,
      proposedCondition,
      sizeHa,
      advanceYears,
      delayYears,
      logger
    )
  }
  if (category === RETENTION_ENHANCED) {
    return buildEnhancedAreaCalculate(
      habitat,
      baseline,
      proposed,
      baselineCondition,
      proposedCondition,
      sizeHa,
      { advanceYears, delayYears, logger }
    )
  }
  skipUnrecognisedRetentionCategory(
    habitat,
    category,
    habitat.retentionCategory ?? baseline.retentionCategory,
    AREA_PROPOSED_LABEL,
    logger
  )
  return null
}

/**
 * Calculate and apply post-intervention units for the proposed side of an
 * area habitat, dispatching on `retentionCategory`.
 *
 * @param {object} habitat
 * @param {{ warn: (msg: string) => void }} logger
 */
export function enrichPostInterventionAreaProposedSide(habitat, logger) {
  if (!hasValidAreaHabitatSize(habitat)) {
    return
  }
  const calculate = resolveAreaProposedCalculate(habitat, logger)
  runProposedCalculation(
    habitat,
    calculate,
    applyProposedResult,
    AREA_PROPOSED_LABEL,
    logger
  )
}

/**
 * @param {object} habitat
 * @param {{ warn: (msg: string) => void }} logger
 */
export function enrichPostInterventionAreaHabitat(habitat, logger) {
  enrichPostInterventionAreaBaselineSide(habitat, logger)
  enrichPostInterventionAreaProposedSide(habitat, logger)
  finalizePostInterventionFeatureStatus(habitat)
}
