import { validateSize } from './validate.js'
import {
  resolveDistinctiveness,
  getConditionMultiplier,
  getTimeMultiplier,
  getDifficultyMultiplier,
  CREATION,
  ENHANCEMENT
} from './multipliers.js'
import { CONDITION_SCORES } from './reference-constants.js'
import { roundToSigFigs } from './utils.js'

/**
 * Enhancement time/difficulty tables use the "Lower" start band when the
 * post-intervention habitat has higher distinctiveness than the baseline habitat
 * (distinctiveness enhancement within the same broad habitat group).
 * @param {number} baselineDistinctivenessScore
 * @param {number} postInterventionDistinctivenessScore
 * @param {string} baselineCondition
 * @returns {string}
 */
function resolveEnhancementTimeStartCondition(
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  baselineCondition
) {
  if (postInterventionDistinctivenessScore > baselineDistinctivenessScore) {
    return 'Lower'
  }
  return baselineCondition
}

/**
 * Resolve a condition band to a numeric score. Enhancement start bands such as
 * "Lower" and "CA N/A" exist in time-to-target tables but not condition scores.
 * @param {string} habitat
 * @param {string} condition
 * @returns {number}
 */
function resolveEnhancementConditionScore(habitat, condition) {
  const scoresRow = CONDITION_SCORES[habitat]
  if (scoresRow && Object.hasOwn(scoresRow, condition)) {
    return getConditionMultiplier(habitat, condition)
  } else if (condition === 'Lower') {
    return getConditionMultiplier(habitat, 'Poor')
  } else if (condition === 'CA N/A') {
    return getConditionMultiplier(habitat, 'Condition Assessment N/A')
  } else {
    return getConditionMultiplier(habitat, condition)
  }
}

/** Metric uses 1 for post-intervention */
const POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER = 1

/**
 * Get area-habitat post-intervention retained biodiversity units for a given size, habitat type, and condition.
 * @param {number} size - The size of the habitat in hectares
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} condition - The condition name (e.g., "Moderate")
 * @returns {object} units, distinctiveness band label, distinctivenessScore, conditionScore, strategicSignificanceScore
 * @throws {Error} If habitat/condition not found or not a valid habitat/condition
 * @example
 * const postInterventionRetained = calculateRetainedAreaHabitatPostIntervention(100, 'Grassland - Modified grassland', 'Moderate')
 * console.log(postInterventionRetained)
 * // Retained habitat - habitat has been retained in the area post-intervention
 * // { units: 400, distinctiveness: 'Low', distinctivenessScore: 2, conditionScore: 2, strategicSignificanceScore: 1 }
 */
export function calculateRetainedAreaHabitatPostIntervention(
  size,
  habitat,
  condition
) {
  validateSize(size)

  const { distinctiveness, distinctivenessScore } =
    resolveDistinctiveness(habitat)
  const conditionScore = getConditionMultiplier(habitat, condition)
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER

  const units = roundToSigFigs(
    size * distinctivenessScore * conditionScore * strategicSignificanceScore
  )

  return {
    units,
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    strategicSignificanceScore
  }
}

export function calculateCreatedAreaHabitatPostIntervention(
  size,
  habitat,
  condition,
  advanceYears,
  delayYears
) {
  validateSize(size)

  const { distinctiveness, distinctivenessScore } =
    resolveDistinctiveness(habitat)
  const conditionScore = getConditionMultiplier(habitat, condition)
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER
  const timeMultiplier = getTimeMultiplier(
    habitat,
    CREATION,
    null,
    condition,
    advanceYears,
    delayYears
  )
  const difficultyMultiplier = getDifficultyMultiplier(
    habitat,
    CREATION,
    null,
    condition,
    advanceYears,
    delayYears
  )

  // Create habitat - habitat has been created in the area post-intervention (e.g. due to development)
  const units = roundToSigFigs(
    size *
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

export function calculateEnhancedAreaHabitatPostIntervention(
  size,
  baselineHabitatType,
  postInterventionHabitatType,
  baselineCondition,
  postInterventionCondition,
  advanceYears,
  delayYears
) {
  validateSize(size)

  const { distinctivenessScore: baselineDistinctivenessScore } =
    resolveDistinctiveness(baselineHabitatType)
  const {
    distinctiveness: postInterventionDistinctiveness,
    distinctivenessScore: postInterventionDistinctivenessScore
  } = resolveDistinctiveness(postInterventionHabitatType)

  const baselineConditionScore = resolveEnhancementConditionScore(
    baselineHabitatType,
    baselineCondition
  )
  const postInterventionConditionScore = resolveEnhancementConditionScore(
    postInterventionHabitatType,
    postInterventionCondition
  )

  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER

  const timeStartCondition = resolveEnhancementTimeStartCondition(
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore,
    baselineCondition
  )

  const timeMultiplier = getTimeMultiplier(
    postInterventionHabitatType,
    ENHANCEMENT,
    timeStartCondition,
    postInterventionCondition,
    advanceYears,
    delayYears
  )
  const difficultyMultiplier = getDifficultyMultiplier(
    postInterventionHabitatType,
    ENHANCEMENT,
    timeStartCondition,
    postInterventionCondition,
    advanceYears,
    delayYears
  )

  const postInterventionValue =
    size * postInterventionDistinctivenessScore * postInterventionConditionScore
  const baselineValue =
    size * baselineDistinctivenessScore * baselineConditionScore
  const riskMultiplier = timeMultiplier * difficultyMultiplier

  const calc =
    ((postInterventionValue - baselineValue) * riskMultiplier + baselineValue) *
    strategicSignificanceScore

  const units = roundToSigFigs(calc)

  return {
    units,
    postInterventionDistinctiveness,
    postInterventionDistinctivenessScore,
    postInterventionConditionScore,
    strategicSignificanceScore,
    timeMultiplier,
    difficultyMultiplier
  }
}
