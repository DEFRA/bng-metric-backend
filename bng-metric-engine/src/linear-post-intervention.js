import { roundToSigFigs } from './utils.js'
import {
  resolveEnhancedLinearLengths,
  resolveLinearConditionScore,
  resolveLinearDistinctiveness,
  validateLinearLength
} from './linear-resolvers.js'

/** Metric uses 1 for post-intervention */
export const POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER = 1

/**
 * Returned by {@link applyEncroachment} for linear types that have no
 * encroachment dimension (e.g. hedgerow): no extra factors, no extra fields.
 */
const NO_ENCROACHMENT = { factors: [], fields: {} }

/**
 * Per-type configuration injected into the generic calculators below.
 * @typedef {object} LinearPostInterventionConfig
 * @property {string} label - Validation label, e.g. "Hedgerow" / "Watercourse"
 * @property {string} resolverLabel - Lookup label, e.g. "hedgerow" / "watercourse"
 * @property {Record<string, string>} distinctivenessCategories
 * @property {Record<string, { Score: number }>} distinctivenessScores
 * @property {Record<string, Record<string, number>>} conditionScores
 * @property {(type: string, condition: string, advanceYears: number, delayYears: number) => number} getCreationTimeMultiplier
 * @property {(type: string, condition: string, advanceYears: number, delayYears: number) => number} getCreationDifficultyMultiplier
 * @property {(ctx: object) => { timeMultiplier: number, difficultyMultiplier: number, standardTimeToTargetCondition?: string, difficulty?: string }} resolveEnhancementMultipliers
 * @property {(encroachment: object, options: { required: boolean }) => { factors: number[], fields: object }} [resolveEncroachmentFactors]
 * @property {(encroachment: object) => { factors: number[], fields: object }} [resolveEnhancedEncroachmentFactors]
 */

/**
 * @param {((encroachment: object, options: object) => { factors: number[], fields: object }) | undefined} hook
 * @param {object} encroachment
 * @param {object} options
 * @returns {{ factors: number[], fields: object }}
 */
function applyEncroachment(hook, encroachment, options) {
  if (!hook) {
    return NO_ENCROACHMENT
  }
  return hook(encroachment, options)
}

/**
 * Get retained post-intervention units for a linear feature of any configured
 * type. Watercourse passes encroachment factors; hedgerow omits them.
 *
 * @param {LinearPostInterventionConfig} cfg
 * @param {{ lengthKm: number, type: string, condition: string, encroachment?: object }} params
 * @returns {object} units, distinctiveness scores, optional encroachment fields, strategicSignificanceScore
 */
export function calculateRetainedLinearPostIntervention(
  cfg,
  { lengthKm, type, condition, encroachment }
) {
  validateLinearLength(lengthKm, cfg.label)

  const { distinctiveness, distinctivenessScore } =
    resolveLinearDistinctiveness(
      type,
      cfg.distinctivenessCategories,
      cfg.distinctivenessScores,
      cfg.resolverLabel
    )
  const conditionScore = resolveLinearConditionScore(
    type,
    condition,
    cfg.conditionScores,
    cfg.resolverLabel
  )
  const { factors, fields } = applyEncroachment(
    cfg.resolveEncroachmentFactors,
    encroachment,
    { required: false }
  )
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER

  let product = lengthKm * distinctivenessScore * conditionScore
  for (const factor of factors) {
    product *= factor
  }
  product *= strategicSignificanceScore

  return {
    units: roundToSigFigs(product),
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    ...fields,
    strategicSignificanceScore
  }
}

/**
 * Get created post-intervention units for a linear feature of any configured
 * type, including time and difficulty multipliers.
 *
 * @param {LinearPostInterventionConfig} cfg
 * @param {{ lengthKm: number, type: string, condition: string, advanceYears: number, delayYears: number, encroachment?: object }} params
 * @returns {object} units, distinctiveness scores, optional encroachment fields, strategicSignificanceScore, timeMultiplier, difficultyMultiplier
 */
export function calculateCreatedLinearPostIntervention(
  cfg,
  { lengthKm, type, condition, advanceYears, delayYears, encroachment }
) {
  validateLinearLength(lengthKm, cfg.label)

  const { distinctiveness, distinctivenessScore } =
    resolveLinearDistinctiveness(
      type,
      cfg.distinctivenessCategories,
      cfg.distinctivenessScores,
      cfg.resolverLabel
    )
  const conditionScore = resolveLinearConditionScore(
    type,
    condition,
    cfg.conditionScores,
    cfg.resolverLabel
  )
  const { factors, fields } = applyEncroachment(
    cfg.resolveEncroachmentFactors,
    encroachment,
    { required: true }
  )
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER
  const timeMultiplier = cfg.getCreationTimeMultiplier(
    type,
    condition,
    advanceYears,
    delayYears
  )
  const difficultyMultiplier = cfg.getCreationDifficultyMultiplier(
    type,
    condition,
    advanceYears,
    delayYears
  )

  let product = lengthKm * distinctivenessScore * conditionScore
  for (const factor of factors) {
    product *= factor
  }
  product *= strategicSignificanceScore
  product *= timeMultiplier
  product *= difficultyMultiplier

  return {
    units: roundToSigFigs(product),
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    ...fields,
    strategicSignificanceScore,
    timeMultiplier,
    difficultyMultiplier
  }
}

/**
 * Resolve baseline and post-intervention distinctiveness and condition scores
 * for an enhanced linear feature.
 *
 * @param {LinearPostInterventionConfig} cfg
 * @param {string} baselineType
 * @param {string} postType
 * @param {string} baselineCondition
 * @param {string} postCondition
 * @returns {{
 *   baselineDistinctivenessScore: number,
 *   postInterventionDistinctiveness: string,
 *   postInterventionDistinctivenessScore: number,
 *   baselineConditionScore: number,
 *   postInterventionConditionScore: number
 * }}
 */
export function resolveEnhancedLinearScores(
  cfg,
  baselineType,
  postType,
  baselineCondition,
  postCondition
) {
  const { distinctivenessScore: baselineDistinctivenessScore } =
    resolveLinearDistinctiveness(
      baselineType,
      cfg.distinctivenessCategories,
      cfg.distinctivenessScores,
      cfg.resolverLabel
    )
  const {
    distinctiveness: postInterventionDistinctiveness,
    distinctivenessScore: postInterventionDistinctivenessScore
  } = resolveLinearDistinctiveness(
    postType,
    cfg.distinctivenessCategories,
    cfg.distinctivenessScores,
    cfg.resolverLabel
  )
  const baselineConditionScore = resolveLinearConditionScore(
    baselineType,
    baselineCondition,
    cfg.conditionScores,
    cfg.resolverLabel
  )
  const postInterventionConditionScore = resolveLinearConditionScore(
    postType,
    postCondition,
    cfg.conditionScores,
    cfg.resolverLabel
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
 * Compute enhanced linear units from resolved scores, lengths, multipliers, and
 * any extra encroachment factors folded into the strategic significance term.
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
 * @param {number[]} [params.encroachmentFactors]
 * @returns {number}
 */
function computeEnhancedLinearUnits({
  baselineLengthKm,
  postInterventionLengthKm,
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  baselineConditionScore,
  postInterventionConditionScore,
  timeMultiplier,
  difficultyMultiplier,
  encroachmentFactors = []
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

  let strategicSignificanceFactor =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER
  for (const factor of encroachmentFactors) {
    strategicSignificanceFactor *= factor
  }

  return roundToSigFigs(
    ((postInterventionValue - baselineValue) * riskMultiplier + baselineValue) *
      strategicSignificanceFactor
  )
}

/**
 * Get enhanced post-intervention units for a linear feature of any configured
 * type, delegating the statutory enhancement-multiplier scenarios and any
 * encroachment handling to the per-type config.
 *
 * @param {LinearPostInterventionConfig} cfg
 * @param {object} params
 * @param {number} params.baselineLengthKm
 * @param {number} params.postInterventionLengthKm
 * @param {string} params.baselineType
 * @param {string} params.postType
 * @param {string} params.baselineCondition
 * @param {string} params.postCondition
 * @param {number} params.advanceYears
 * @param {number} params.delayYears
 * @param {object} [params.encroachment]
 * @returns {object}
 */
export function calculateEnhancedLinearPostIntervention(
  cfg,
  {
    baselineLengthKm,
    postInterventionLengthKm,
    baselineType,
    postType,
    baselineCondition,
    postCondition,
    advanceYears,
    delayYears,
    encroachment
  }
) {
  validateLinearLength(baselineLengthKm, `${cfg.label} baseline`)
  validateLinearLength(
    postInterventionLengthKm,
    `${cfg.label} post-intervention`
  )

  const scores = resolveEnhancedLinearScores(
    cfg,
    baselineType,
    postType,
    baselineCondition,
    postCondition
  )
  const { factors, fields } = applyEncroachment(
    cfg.resolveEnhancedEncroachmentFactors,
    encroachment,
    {}
  )
  const enhancementMetrics = cfg.resolveEnhancementMultipliers({
    baselineDistinctivenessScore: scores.baselineDistinctivenessScore,
    postInterventionDistinctivenessScore:
      scores.postInterventionDistinctivenessScore,
    baselineType,
    postType,
    baselineCondition,
    postCondition,
    advanceYears,
    delayYears
  })

  const units = computeEnhancedLinearUnits({
    baselineLengthKm,
    postInterventionLengthKm,
    baselineDistinctivenessScore: scores.baselineDistinctivenessScore,
    postInterventionDistinctivenessScore:
      scores.postInterventionDistinctivenessScore,
    baselineConditionScore: scores.baselineConditionScore,
    postInterventionConditionScore: scores.postInterventionConditionScore,
    timeMultiplier: enhancementMetrics.timeMultiplier,
    difficultyMultiplier: enhancementMetrics.difficultyMultiplier,
    encroachmentFactors: factors
  })

  return {
    units,
    postInterventionDistinctiveness: scores.postInterventionDistinctiveness,
    postInterventionDistinctivenessScore:
      scores.postInterventionDistinctivenessScore,
    postInterventionConditionScore: scores.postInterventionConditionScore,
    ...fields,
    strategicSignificanceScore:
      POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER,
    ...enhancementMetrics
  }
}
