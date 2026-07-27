import {
  getHedgerowCreationDifficultyLabel,
  getHedgerowCreationDifficultyMultiplier,
  getHedgerowCreationTimeMultiplier,
  getHedgerowCreationTimeToTargetValue,
  getHedgerowEnhancementDifficultyLabel,
  getHedgerowEnhancementDifficultyMultiplier,
  getHedgerowEnhancementTimeMultiplier,
  getHedgerowEnhancementTimeToTargetValue
} from './linear-hedgerow-multipliers.js'
import { isDistinctivenessEnhancement } from './linear-resolvers.js'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES
} from './reference-constants.js'
import {
  calculateCreatedLinearPostIntervention,
  calculateEnhancedLinearPostIntervention,
  calculateRetainedLinearPostIntervention
} from './linear-post-intervention.js'

const HEDGEROW_RESOLVER_LABEL = 'hedgerow'
const POOR_CONDITION = 'Poor'
const STATUTORY_ADVANCE_YEARS = 0
const STATUTORY_DELAY_YEARS = 0

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
    return POOR_CONDITION
  }
  return baselineCondition
}

/**
 * Resolve time and difficulty multipliers for an enhanced hedgerow.
 *
 * @param {{
 *   baselineDistinctivenessScore: number,
 *   postInterventionDistinctivenessScore: number,
 *   postType: string,
 *   baselineCondition: string,
 *   postCondition: string,
 *   advanceYears: number,
 *   delayYears: number
 * }} enhancementContext
 * @returns {{ timeMultiplier: number, difficultyMultiplier: number, standardTimeToTargetCondition: string, difficulty: string }}
 */
function resolveHedgerowEnhancementMultipliers({
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  postType,
  baselineCondition,
  postCondition,
  advanceYears,
  delayYears
}) {
  if (
    isDistinctivenessEnhancement(
      baselineDistinctivenessScore,
      postInterventionDistinctivenessScore
    ) &&
    baselineCondition === POOR_CONDITION
  ) {
    return {
      timeMultiplier: getHedgerowCreationTimeMultiplier(
        postType,
        postCondition,
        advanceYears,
        delayYears
      ),
      difficultyMultiplier: getHedgerowCreationDifficultyMultiplier(
        postType,
        postCondition,
        advanceYears,
        delayYears
      ),
      standardTimeToTargetCondition: getHedgerowCreationTimeToTargetValue(
        postType,
        postCondition,
        STATUTORY_ADVANCE_YEARS,
        STATUTORY_DELAY_YEARS
      ),
      difficulty: getHedgerowCreationDifficultyLabel(
        postType,
        postCondition,
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
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getHedgerowEnhancementDifficultyMultiplier(
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    ),
    standardTimeToTargetCondition: getHedgerowEnhancementTimeToTargetValue(
      postType,
      timeStartCondition,
      postCondition,
      STATUTORY_ADVANCE_YEARS,
      STATUTORY_DELAY_YEARS
    ),
    difficulty: getHedgerowEnhancementDifficultyLabel(
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    )
  }
}

/** @type {import('./linear-post-intervention.js').LinearPostInterventionConfig} */
const HEDGEROW_PI_CONFIG = {
  label: 'Hedgerow',
  resolverLabel: HEDGEROW_RESOLVER_LABEL,
  distinctivenessCategories: HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  distinctivenessScores: HEDGEROW_DISTINCTIVENESS_SCORES,
  conditionScores: HEDGEROW_CONDITION_SCORES,
  getCreationTimeMultiplier: getHedgerowCreationTimeMultiplier,
  getCreationDifficultyMultiplier: getHedgerowCreationDifficultyMultiplier,
  resolveEnhancementMultipliers: resolveHedgerowEnhancementMultipliers
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
 * @throws {BaselineLookupError} If hedgeType or condition is not found in the reference tables
 * @example
 * const result = calculateHedgerowBaseline(0.5, 'Native hedgerow', 'Good')
 * // { units: 3, distinctiveness: 'Low', distinctivenessScore: 2, conditionScore: 3, strategicSignificanceScore: 1 }
 */
export function calculateRetainedHedgerowPostIntervention(
  lengthKm,
  hedgeType,
  condition
) {
  return calculateRetainedLinearPostIntervention(HEDGEROW_PI_CONFIG, {
    lengthKm,
    type: hedgeType,
    condition
  })
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
  return calculateCreatedLinearPostIntervention(HEDGEROW_PI_CONFIG, {
    lengthKm,
    type: hedgeType,
    condition,
    advanceYears,
    delayYears
  })
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
 * @throws {BaselineLookupError} If hedgeType or condition is not found in the reference tables
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
  return calculateEnhancedLinearPostIntervention(HEDGEROW_PI_CONFIG, {
    baselineLengthKm,
    postInterventionLengthKm,
    baselineType: baselineHedgeType,
    postType: postInterventionHedgeType,
    baselineCondition,
    postCondition: postInterventionCondition,
    advanceYears,
    delayYears
  })
}
