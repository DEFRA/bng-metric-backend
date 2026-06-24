import {
  getWatercourseCreationDifficultyMultiplier,
  getWatercourseCreationTimeMultiplier,
  getWatercourseEnhancementDifficultyMultiplier,
  getWatercourseEnhancementTimeMultiplier
} from './linear-watercourse-multipliers.js'
import { roundToSigFigs } from './utils.js'
import {
  isDistinctivenessEnhancement,
  resolveEncroachmentMultiplier,
  resolveEnhancedLinearLengths,
  resolveLinearConditionScore,
  resolveLinearDistinctiveness,
  resolveRequiredEncroachmentMultiplier,
  validateLinearLength
} from './linear-resolvers.js'
import {
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from './reference-constants.js'

// Metric uses 1 for post-intervention
const POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER = 1
const WATERCOURSE_ENCROACHMENT_LOOKUP_LABEL = 'watercourse encroachment'
const RIPARIAN_ENCROACHMENT_LOOKUP_LABEL = 'riparian encroachment'

/**
 * Resolve time and difficulty multipliers for an enhanced watercourse, handling
 * the three statutory scenarios: Poor-baseline distinctiveness uplift,
 * cross-type distinctiveness uplift, and same-type enhancement.
 *
 * @param {{
 *   baselineDistinctivenessScore: number,
 *   postInterventionDistinctivenessScore: number,
 *   baselineWatercourseType: string,
 *   postInterventionWatercourseType: string,
 *   baselineCondition: string,
 *   postInterventionCondition: string,
 *   advanceYears: number,
 *   delayYears: number
 * }} enhancementContext
 * @returns {{ timeMultiplier: number, difficultyMultiplier: number }}
 */
function resolveWatercourseEnhancementMultipliers(enhancementContext) {
  const {
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore,
    baselineWatercourseType,
    postInterventionWatercourseType,
    baselineCondition,
    postInterventionCondition,
    advanceYears,
    delayYears
  } = enhancementContext

  const distinctivenessEnhancement = isDistinctivenessEnhancement(
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore
  )
  const crossWatercourseType =
    baselineWatercourseType !== postInterventionWatercourseType

  if (distinctivenessEnhancement && baselineCondition === 'Poor') {
    return {
      timeMultiplier: getWatercourseCreationTimeMultiplier(
        postInterventionWatercourseType,
        postInterventionCondition,
        advanceYears,
        delayYears
      ),
      difficultyMultiplier: getWatercourseCreationDifficultyMultiplier(
        postInterventionWatercourseType,
        postInterventionCondition,
        advanceYears,
        delayYears
      )
    }
  }

  if (distinctivenessEnhancement && crossWatercourseType) {
    return {
      timeMultiplier: getWatercourseCreationTimeMultiplier(
        postInterventionWatercourseType,
        postInterventionCondition,
        advanceYears,
        delayYears
      ),
      difficultyMultiplier: getWatercourseEnhancementDifficultyMultiplier(
        postInterventionWatercourseType,
        'Poor',
        postInterventionCondition,
        advanceYears,
        delayYears
      )
    }
  }

  const timeStartCondition = distinctivenessEnhancement
    ? 'Poor'
    : baselineCondition
  return {
    timeMultiplier: getWatercourseEnhancementTimeMultiplier(
      postInterventionWatercourseType,
      timeStartCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getWatercourseEnhancementDifficultyMultiplier(
      postInterventionWatercourseType,
      timeStartCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    )
  }
}

/**
 * Get retained watercourse post-intervention units for a given length,
 * watercourse type, condition, and encroachment values.
 *
 * @param {number} lengthKm - Length in kilometres
 * @param {string} watercourseType - Watercourse type (e.g. "Priority habitat")
 * @param {string} condition - Condition band (e.g. "Good", "Moderate")
 * @param {string | null} [watercourseEncroachment] - Encroachment into watercourse (e.g. "Minor")
 * @param {string | null} [riparianEncroachment] - Encroachment into riparian zone (e.g. "Minor/No Encroachment")
 * @returns {{ units: number, distinctiveness: string, distinctivenessScore: number, conditionScore: number, waterEncroachmentMultiplier: number, riparianEncroachmentMultiplier: number, strategicSignificanceScore: number }}
 */
export function calculateRetainedWatercoursePostIntervention(
  lengthKm,
  watercourseType,
  condition,
  watercourseEncroachment = null,
  riparianEncroachment = null
) {
  validateLinearLength(lengthKm, 'Watercourse')

  const { distinctiveness, distinctivenessScore } =
    resolveLinearDistinctiveness(
      watercourseType,
      WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
      WATERCOURSE_DISTINCTIVENESS_SCORES,
      'watercourse'
    )
  const conditionScore = resolveLinearConditionScore(
    watercourseType,
    condition,
    WATERCOURSE_CONDITION_SCORES,
    'watercourse'
  )
  const waterEncroachmentMultiplier = resolveEncroachmentMultiplier(
    watercourseEncroachment,
    WATERCOURSE_ENCROACHMENT_MULTIPLIER,
    WATERCOURSE_ENCROACHMENT_LOOKUP_LABEL
  )
  const riparianEncroachmentMultiplier = resolveEncroachmentMultiplier(
    riparianEncroachment,
    WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
    RIPARIAN_ENCROACHMENT_LOOKUP_LABEL
  )
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER

  const units = roundToSigFigs(
    lengthKm *
      distinctivenessScore *
      conditionScore *
      waterEncroachmentMultiplier *
      riparianEncroachmentMultiplier *
      strategicSignificanceScore
  )

  return {
    units,
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    waterEncroachmentMultiplier,
    riparianEncroachmentMultiplier,
    strategicSignificanceScore
  }
}

/**
 * Get created watercourse post-intervention units for a given length,
 * watercourse type, condition, encroachment values, and advance/delay years.
 *
 * @param {number} lengthKm - Length in kilometres
 * @param {string} watercourseType - Watercourse type (e.g. "Priority habitat")
 * @param {string} condition - Condition band (e.g. "Moderate")
 * @param {string} watercourseEncroachment - Encroachment into watercourse
 * @param {string} riparianEncroachment - Encroachment into riparian zone
 * @param {number} [advanceYears=0] - Years habitat is advanced beyond 30 years
 * @param {number} [delayYears=0] - Years delivery is delayed
 * @returns {{ units: number, distinctiveness: string, distinctivenessScore: number, conditionScore: number, waterEncroachmentMultiplier: number, riparianEncroachmentMultiplier: number, strategicSignificanceScore: number, timeMultiplier: number, difficultyMultiplier: number }}
 */
export function calculateCreatedWatercoursePostIntervention(
  lengthKm,
  watercourseType,
  condition,
  watercourseEncroachment,
  riparianEncroachment,
  advanceYears = 0,
  delayYears = 0
) {
  validateLinearLength(lengthKm, 'Watercourse')

  const { distinctiveness, distinctivenessScore } =
    resolveLinearDistinctiveness(
      watercourseType,
      WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
      WATERCOURSE_DISTINCTIVENESS_SCORES,
      'watercourse'
    )
  const conditionScore = resolveLinearConditionScore(
    watercourseType,
    condition,
    WATERCOURSE_CONDITION_SCORES,
    'watercourse'
  )
  const waterEncroachmentMultiplier = resolveRequiredEncroachmentMultiplier(
    watercourseEncroachment,
    WATERCOURSE_ENCROACHMENT_MULTIPLIER,
    WATERCOURSE_ENCROACHMENT_LOOKUP_LABEL
  )
  const riparianEncroachmentMultiplier = resolveRequiredEncroachmentMultiplier(
    riparianEncroachment,
    WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
    RIPARIAN_ENCROACHMENT_LOOKUP_LABEL
  )
  const strategicSignificanceScore =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER
  const timeMultiplier = getWatercourseCreationTimeMultiplier(
    watercourseType,
    condition,
    advanceYears,
    delayYears
  )
  const difficultyMultiplier = getWatercourseCreationDifficultyMultiplier(
    watercourseType,
    condition,
    advanceYears,
    delayYears
  )

  const units = roundToSigFigs(
    lengthKm *
      distinctivenessScore *
      conditionScore *
      waterEncroachmentMultiplier *
      riparianEncroachmentMultiplier *
      strategicSignificanceScore *
      timeMultiplier *
      difficultyMultiplier
  )

  return {
    units,
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    waterEncroachmentMultiplier,
    riparianEncroachmentMultiplier,
    strategicSignificanceScore,
    timeMultiplier,
    difficultyMultiplier
  }
}

/**
 * Resolve post-intervention encroachment multipliers from raw values.
 *
 * @param {string | null | undefined} watercourseEncroachment
 * @param {string | null | undefined} riparianEncroachment
 * @returns {{ postInterventionWaterEncroachmentMultiplier: number, postInterventionRiparianEncroachmentMultiplier: number }}
 */
function resolveEnhancedWatercourseEncroachmentMultipliers(
  watercourseEncroachment,
  riparianEncroachment
) {
  return {
    postInterventionWaterEncroachmentMultiplier: resolveEncroachmentMultiplier(
      watercourseEncroachment,
      WATERCOURSE_ENCROACHMENT_MULTIPLIER,
      WATERCOURSE_ENCROACHMENT_LOOKUP_LABEL
    ),
    postInterventionRiparianEncroachmentMultiplier:
      resolveEncroachmentMultiplier(
        riparianEncroachment,
        WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
        RIPARIAN_ENCROACHMENT_LOOKUP_LABEL
      )
  }
}

/**
 * Resolve baseline and post-intervention distinctiveness and condition scores
 * for an enhanced watercourse.
 *
 * @param {string} baselineWatercourseType
 * @param {string} postInterventionWatercourseType
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
function resolveEnhancedWatercourseScores(
  baselineWatercourseType,
  postInterventionWatercourseType,
  baselineCondition,
  postInterventionCondition
) {
  const { distinctivenessScore: baselineDistinctivenessScore } =
    resolveLinearDistinctiveness(
      baselineWatercourseType,
      WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
      WATERCOURSE_DISTINCTIVENESS_SCORES,
      'watercourse'
    )
  const {
    distinctiveness: postInterventionDistinctiveness,
    distinctivenessScore: postInterventionDistinctivenessScore
  } = resolveLinearDistinctiveness(
    postInterventionWatercourseType,
    WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
    WATERCOURSE_DISTINCTIVENESS_SCORES,
    'watercourse'
  )
  const baselineConditionScore = resolveLinearConditionScore(
    baselineWatercourseType,
    baselineCondition,
    WATERCOURSE_CONDITION_SCORES,
    'watercourse'
  )
  const postInterventionConditionScore = resolveLinearConditionScore(
    postInterventionWatercourseType,
    postInterventionCondition,
    WATERCOURSE_CONDITION_SCORES,
    'watercourse'
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
 * Compute enhanced watercourse units from resolved scores, lengths, and multipliers.
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
 * @param {number} params.postInterventionWaterEncroachmentMultiplier
 * @param {number} params.postInterventionRiparianEncroachmentMultiplier
 * @returns {number}
 */
function computeEnhancedWatercourseUnits({
  baselineLengthKm,
  postInterventionLengthKm,
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  baselineConditionScore,
  postInterventionConditionScore,
  timeMultiplier,
  difficultyMultiplier,
  postInterventionWaterEncroachmentMultiplier,
  postInterventionRiparianEncroachmentMultiplier
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
  const strategicSignificanceFactor =
    POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER *
    postInterventionWaterEncroachmentMultiplier *
    postInterventionRiparianEncroachmentMultiplier

  return roundToSigFigs(
    ((postInterventionValue - baselineValue) * riskMultiplier + baselineValue) *
      strategicSignificanceFactor
  )
}

/**
 * Get enhanced watercourse post-intervention units for baseline and
 * post-intervention lengths, watercourse types and conditions,
 * post-intervention encroachment values, and advance/delay years.
 *
 * @param {number} baselineLengthKm - Baseline length in kilometres
 * @param {number} postInterventionLengthKm - Post-intervention length in kilometres
 * @param {string} baselineWatercourseType - Baseline watercourse type
 * @param {string} postInterventionWatercourseType - Post-intervention watercourse type
 * @param {string} baselineCondition - Baseline condition band
 * @param {string} postInterventionCondition - Post-intervention condition band
 * @param {{ watercourseEncroachment?: string | null, riparianEncroachment?: string | null, advanceYears?: number, delayYears?: number }} [options] - Post-intervention encroachment and timing
 * @returns {{ units: number, postInterventionDistinctiveness: string, postInterventionDistinctivenessScore: number, postInterventionConditionScore: number, postInterventionWaterEncroachmentMultiplier: number, postInterventionRiparianEncroachmentMultiplier: number, strategicSignificanceScore: number, timeMultiplier: number, difficultyMultiplier: number }}
 * @throws {TypeError} If either length is invalid
 * @throws {PostInterventionLookupError} If watercourse type, condition, or encroachment is not found in the reference tables
 */
export function calculateEnhancedWatercoursePostIntervention(
  baselineLengthKm,
  postInterventionLengthKm,
  baselineWatercourseType,
  postInterventionWatercourseType,
  baselineCondition,
  postInterventionCondition,
  {
    watercourseEncroachment: postInterventionWatercourseEncroachment = null,
    riparianEncroachment: postInterventionRiparianEncroachment = null,
    advanceYears = 0,
    delayYears = 0
  } = {}
) {
  validateLinearLength(baselineLengthKm, 'Watercourse baseline')
  validateLinearLength(
    postInterventionLengthKm,
    'Watercourse post-intervention'
  )
  const {
    baselineDistinctivenessScore,
    postInterventionDistinctiveness,
    postInterventionDistinctivenessScore,
    baselineConditionScore,
    postInterventionConditionScore
  } = resolveEnhancedWatercourseScores(
    baselineWatercourseType,
    postInterventionWatercourseType,
    baselineCondition,
    postInterventionCondition
  )
  const {
    postInterventionWaterEncroachmentMultiplier,
    postInterventionRiparianEncroachmentMultiplier
  } = resolveEnhancedWatercourseEncroachmentMultipliers(
    postInterventionWatercourseEncroachment,
    postInterventionRiparianEncroachment
  )
  const { timeMultiplier, difficultyMultiplier } =
    resolveWatercourseEnhancementMultipliers({
      baselineDistinctivenessScore,
      postInterventionDistinctivenessScore,
      baselineWatercourseType,
      postInterventionWatercourseType,
      baselineCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    })
  const units = computeEnhancedWatercourseUnits({
    baselineLengthKm,
    postInterventionLengthKm,
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore,
    baselineConditionScore,
    postInterventionConditionScore,
    timeMultiplier,
    difficultyMultiplier,
    postInterventionWaterEncroachmentMultiplier,
    postInterventionRiparianEncroachmentMultiplier
  })

  return {
    units,
    postInterventionDistinctiveness,
    postInterventionDistinctivenessScore,
    postInterventionConditionScore,
    postInterventionWaterEncroachmentMultiplier,
    postInterventionRiparianEncroachmentMultiplier,
    strategicSignificanceScore:
      POST_INTERVENTION_STRATEGIC_SIGNIFICANCE_MULTIPLIER,
    timeMultiplier,
    difficultyMultiplier
  }
}
