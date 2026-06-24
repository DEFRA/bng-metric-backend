import {
  getHedgerowCreationDifficultyMultiplier,
  getHedgerowCreationTimeMultiplier,
  getHedgerowEnhancementDifficultyMultiplier,
  getHedgerowEnhancementTimeMultiplier
} from './linear-hedgerow-multipliers.js'
import { roundToSigFigs } from './utils.js'
import {
  isDistinctivenessEnhancement,
  resolveEnhancedLinearLengths,
  resolveLinearConditionScore,
  resolveLinearDistinctiveness,
  validateLinearLength
} from './linear-resolvers.js'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES
} from './reference-constants.js'

// Metric uses 1 for post-intervention
const POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER = 1

/**
 * Enhancement-through-distinctiveness from a Poor baseline uses creation
 * time-to-target on the post-intervention hedge. Otherwise the enhancement
 * table uses the "Poor" start band on the post-intervention hedge type.
 * @param {number} baselineDistinctivenessScore
 * @param {number} postInterventionDistinctivenessScore
 * @param {string} baselineCondition
 * @returns {string}
 */
function resolveHedgerowEnhancementTimeStartCondition(
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  baselineCondition
) {
  if (
    isDistinctivenessEnhancement(
      baselineDistinctivenessScore,
      postInterventionDistinctivenessScore
    )
  ) {
    return 'Poor'
  }
  return baselineCondition
}

/**
 * Resolve time and difficulty multipliers for an enhanced hedgerow.
 *
 * @param {number} baselineDistinctivenessScore
 * @param {number} postInterventionDistinctivenessScore
 * @param {string} postInterventionHedgeType
 * @param {string} baselineCondition
 * @param {string} postInterventionCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {{ timeMultiplier: number, difficultyMultiplier: number }}
 */
function resolveHedgerowEnhancementMultipliers(
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  postInterventionHedgeType,
  baselineCondition,
  postInterventionCondition,
  advanceYears,
  delayYears
) {
  if (
    isDistinctivenessEnhancement(
      baselineDistinctivenessScore,
      postInterventionDistinctivenessScore
    ) &&
    baselineCondition === 'Poor'
  ) {
    return {
      timeMultiplier: getHedgerowCreationTimeMultiplier(
        postInterventionHedgeType,
        postInterventionCondition,
        advanceYears,
        delayYears
      ),
      difficultyMultiplier: getHedgerowCreationDifficultyMultiplier(
        postInterventionHedgeType,
        postInterventionCondition,
        advanceYears,
        delayYears
      )
    }
  }

  const timeStartCondition = resolveHedgerowEnhancementTimeStartCondition(
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore,
    baselineCondition
  )
  return {
    timeMultiplier: getHedgerowEnhancementTimeMultiplier(
      postInterventionHedgeType,
      timeStartCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getHedgerowEnhancementDifficultyMultiplier(
      postInterventionHedgeType,
      timeStartCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    )
  }
}

/**
 * Get hedgerow retained hedgerow units for a given length, hedge type,
 * and condition.
 *
 * @param {number} lengthKm - Length in kilometres
 * @param {string} hedgeType - Hedgerow type (e.g. "Species-rich native hedgerow")
 * @param {string} condition - Condition band (e.g. "Good", "Moderate")
 * @returns {{ units: number, distinctiveness: string, distinctivenessScore: number, conditionScore: number, strategicSignificanceScore: number }}
 * @throws {TypeError} If length is invalid
 * @throws {PostInterventionLookupError} If hedgeType or condition is not found in the reference tables
 * @example
 * const result = calculateHedgerowBaseline(0.5, 'Native hedgerow', 'Good')
 * // { units: 3, distinctiveness: 'Low', distinctivenessScore: 2, conditionScore: 3, strategicSignificanceScore: 1 }
 */
export function calculateRetainedHedgerowPostIntervention(
  lengthKm,
  hedgeType,
  condition
) {
  validateLinearLength(lengthKm, 'Hedgerow')

  const { distinctiveness, distinctivenessScore } =
    resolveLinearDistinctiveness(
      hedgeType,
      HEDGEROW_DISTINCTIVENESS_CATEGORIES,
      HEDGEROW_DISTINCTIVENESS_SCORES,
      'hedgerow'
    )
  const conditionScore = resolveLinearConditionScore(
    hedgeType,
    condition,
    HEDGEROW_CONDITION_SCORES,
    'hedgerow'
  )
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER

  const units = roundToSigFigs(
    lengthKm *
      distinctivenessScore *
      conditionScore *
      strategicSignificanceScore
  )

  return {
    units,
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    strategicSignificanceScore
  }
}

/**
 * Get hedgerow creation units for a given length, hedge type, condition,
 * and advance/delay years.
 *
 * @param {number} lengthKm - Length in kilometres
 * @param {string} hedgeType - Hedgerow type (e.g. "Native hedgerow")
 * @param {string} condition - Condition band (e.g. "Good", "Moderate")
 * @param {number} advanceYears - Years habitat is advanced beyond 30 years
 * @param {number} delayYears - Years delivery is delayed
 * @returns {{ units: number, distinctiveness: string, distinctivenessScore: number, conditionScore: number, strategicSignificanceScore: number, timeMultiplier: number, difficultyMultiplier: number }}
 * @throws {TypeError} If length is invalid
 * @throws {BaselineLookupError} If hedgeType or condition is not found in the reference tables
 */
export function calculateCreatedHedgerowPostIntervention(
  lengthKm,
  hedgeType,
  condition,
  advanceYears,
  delayYears
) {
  validateLinearLength(lengthKm, 'Hedgerow')

  const { distinctiveness, distinctivenessScore } =
    resolveLinearDistinctiveness(
      hedgeType,
      HEDGEROW_DISTINCTIVENESS_CATEGORIES,
      HEDGEROW_DISTINCTIVENESS_SCORES,
      'hedgerow'
    )
  const conditionScore = resolveLinearConditionScore(
    hedgeType,
    condition,
    HEDGEROW_CONDITION_SCORES,
    'hedgerow'
  )
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER
  const timeMultiplier = getHedgerowCreationTimeMultiplier(
    hedgeType,
    condition,
    advanceYears,
    delayYears
  )
  const difficultyMultiplier = getHedgerowCreationDifficultyMultiplier(
    hedgeType,
    condition,
    advanceYears,
    delayYears
  )

  const units = roundToSigFigs(
    lengthKm *
      distinctivenessScore *
      conditionScore *
      strategicSignificanceScore *
      timeMultiplier *
      difficultyMultiplier
  )

  return {
    units,
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    strategicSignificanceScore,
    timeMultiplier,
    difficultyMultiplier
  }
}

/**
 * Resolve baseline and post-intervention distinctiveness and condition scores.
 *
 * @param {string} baselineHedgeType
 * @param {string} postInterventionHedgeType
 * @param {string} baselineCondition
 * @param {string} postInterventionCondition
 * @returns {{
 *   baselineDistinctivenessScore: number,
 *   postInterventionDistinctiveness: string,
 *   postInterventionDistinctivenessScore: number,
 *   baselineConditionScore: number,
 *   postInterventionConditionScore: number
 * }}
 */
function resolveEnhancedHedgerowScores(
  baselineHedgeType,
  postInterventionHedgeType,
  baselineCondition,
  postInterventionCondition
) {
  const { distinctivenessScore: baselineDistinctivenessScore } =
    resolveLinearDistinctiveness(
      baselineHedgeType,
      HEDGEROW_DISTINCTIVENESS_CATEGORIES,
      HEDGEROW_DISTINCTIVENESS_SCORES,
      'hedgerow'
    )

  const {
    distinctiveness: postInterventionDistinctiveness,
    distinctivenessScore: postInterventionDistinctivenessScore
  } = resolveLinearDistinctiveness(
    postInterventionHedgeType,
    HEDGEROW_DISTINCTIVENESS_CATEGORIES,
    HEDGEROW_DISTINCTIVENESS_SCORES,
    'hedgerow'
  )

  const baselineConditionScore = resolveLinearConditionScore(
    baselineHedgeType,
    baselineCondition,
    HEDGEROW_CONDITION_SCORES,
    'hedgerow'
  )

  const postInterventionConditionScore = resolveLinearConditionScore(
    postInterventionHedgeType,
    postInterventionCondition,
    HEDGEROW_CONDITION_SCORES,
    'hedgerow'
  )

  return {
    baselineDistinctivenessScore,
    postInterventionDistinctiveness,
    postInterventionDistinctivenessScore,
    baselineConditionScore,
    postInterventionConditionScore
  }
}

/**
 * Compute enhanced hedgerow units from resolved scores, lengths, and multipliers.
 *
 * @param {object} params
 * @param {number} params.baselineLengthKm
 * @param {number} params.postInterventionLengthKm
 * @param {number} params.baselineDistinctivenessScore
 * @param {number} params.postInterventionDistinctivenessScore
 * @param {number} params.baselineConditionScore
 * @param {number} params.postInterventionConditionScore
 * @param {number} params.timeMultiplier
 * @param {number} params.difficultyMultiplier
 * @returns {number}
 */
function computeEnhancedHedgerowUnits({
  baselineLengthKm,
  postInterventionLengthKm,
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  baselineConditionScore,
  postInterventionConditionScore,
  timeMultiplier,
  difficultyMultiplier
}) {
  const {
    postInterventionLengthKm: postLengthKm,
    baselineLengthKm: baseLengthKm
  } = resolveEnhancedLinearLengths(baselineLengthKm, postInterventionLengthKm)

  const postInterventionValue =
    postLengthKm *
    postInterventionDistinctivenessScore *
    postInterventionConditionScore
  const baselineValue =
    baseLengthKm * baselineDistinctivenessScore * baselineConditionScore
  const riskMultiplier = timeMultiplier * difficultyMultiplier

  return roundToSigFigs(
    ((postInterventionValue - baselineValue) * riskMultiplier + baselineValue) *
      POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER
  )
}

/**
 * Get enhanced hedgerow post-intervention units for baseline and
 * post-intervention lengths, hedge types and conditions, and advance/delay years.
 *
 * @param {number} baselineLengthKm - Baseline length in kilometres
 * @param {number} postInterventionLengthKm - Post-intervention length in kilometres
 * @param {string} baselineHedgeType - Baseline hedge type
 * @param {string} postInterventionHedgeType - Post-intervention hedge type
 * @param {string} baselineCondition - Baseline condition band
 * @param {string} postInterventionCondition - Post-intervention condition band
 * @param {{ advanceYears?: number, delayYears?: number }} [options] - Advance and delay years
 * @returns {{ units: number, postInterventionDistinctiveness: string, postInterventionDistinctivenessScore: number, postInterventionConditionScore: number, strategicSignificanceScore: number, timeMultiplier: number, difficultyMultiplier: number }}
 * @throws {TypeError} If either length is invalid
 * @throws {PostInterventionLookupError} If hedgeType or condition is not found in the reference tables
 */
export function calculateEnhancedHedgerowPostIntervention(
  baselineLengthKm,
  postInterventionLengthKm,
  baselineHedgeType,
  postInterventionHedgeType,
  baselineCondition,
  postInterventionCondition,
  { advanceYears = 0, delayYears = 0 } = {}
) {
  validateLinearLength(baselineLengthKm, 'Hedgerow baseline')
  validateLinearLength(postInterventionLengthKm, 'Hedgerow post-intervention')

  const {
    baselineDistinctivenessScore,
    postInterventionDistinctiveness,
    postInterventionDistinctivenessScore,
    baselineConditionScore,
    postInterventionConditionScore
  } = resolveEnhancedHedgerowScores(
    baselineHedgeType,
    postInterventionHedgeType,
    baselineCondition,
    postInterventionCondition
  )

  const { timeMultiplier, difficultyMultiplier } =
    resolveHedgerowEnhancementMultipliers(
      baselineDistinctivenessScore,
      postInterventionDistinctivenessScore,
      postInterventionHedgeType,
      baselineCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    )

  const units = computeEnhancedHedgerowUnits({
    baselineLengthKm,
    postInterventionLengthKm,
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore,
    baselineConditionScore,
    postInterventionConditionScore,
    timeMultiplier,
    difficultyMultiplier
  })

  return {
    units,
    postInterventionDistinctiveness,
    postInterventionDistinctivenessScore,
    postInterventionConditionScore,
    strategicSignificanceScore:
      POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER,
    timeMultiplier,
    difficultyMultiplier
  }
}
