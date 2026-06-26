import {
  getWatercourseCreationDifficultyMultiplier,
  getWatercourseCreationTimeMultiplier,
  getWatercourseEnhancementDifficultyMultiplier,
  getWatercourseEnhancementTimeMultiplier
} from './linear-watercourse-multipliers.js'
import {
  isDistinctivenessEnhancement,
  resolveEncroachmentMultiplier,
  resolveRequiredEncroachmentMultiplier
} from './linear-resolvers.js'
import {
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from './reference-constants.js'
import {
  calculateCreatedLinearPostIntervention,
  calculateEnhancedLinearPostIntervention,
  calculateRetainedLinearPostIntervention
} from './linear-post-intervention.js'

const WATERCOURSE_ENCROACHMENT_LOOKUP_LABEL = 'watercourse encroachment'
const RIPARIAN_ENCROACHMENT_LOOKUP_LABEL = 'riparian encroachment'
const WATERCOURSE_RESOLVER_LABEL = 'watercourse'
const POOR_CONDITION = 'Poor'

/**
 * Resolve time and difficulty multipliers for an enhanced watercourse, handling
 * the three statutory scenarios: Poor-baseline distinctiveness uplift,
 * cross-type distinctiveness uplift, and same-type enhancement.
 *
 * @param {{
 *   baselineDistinctivenessScore: number,
 *   postInterventionDistinctivenessScore: number,
 *   baselineType: string,
 *   postType: string,
 *   baselineCondition: string,
 *   postCondition: string,
 *   advanceYears: number,
 *   delayYears: number
 * }} enhancementContext
 * @returns {{ timeMultiplier: number, difficultyMultiplier: number }}
 */
function resolveWatercourseEnhancementMultipliers(enhancementContext) {
  const {
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore,
    baselineType,
    postType,
    baselineCondition,
    postCondition,
    advanceYears,
    delayYears
  } = enhancementContext

  const distinctivenessEnhancement = isDistinctivenessEnhancement(
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore
  )
  const crossWatercourseType = baselineType !== postType

  if (distinctivenessEnhancement && baselineCondition === POOR_CONDITION) {
    return {
      timeMultiplier: getWatercourseCreationTimeMultiplier(
        postType,
        postCondition,
        advanceYears,
        delayYears
      ),
      difficultyMultiplier: getWatercourseCreationDifficultyMultiplier(
        postType,
        postCondition,
        advanceYears,
        delayYears
      )
    }
  }
  if (distinctivenessEnhancement && crossWatercourseType) {
    return {
      timeMultiplier: getWatercourseCreationTimeMultiplier(
        postType,
        postCondition,
        advanceYears,
        delayYears
      ),
      difficultyMultiplier: getWatercourseEnhancementDifficultyMultiplier(
        postType,
        POOR_CONDITION,
        postCondition,
        advanceYears,
        delayYears
      )
    }
  }

  const timeStartCondition = distinctivenessEnhancement
    ? POOR_CONDITION
    : baselineCondition
  return {
    timeMultiplier: getWatercourseEnhancementTimeMultiplier(
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getWatercourseEnhancementDifficultyMultiplier(
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    )
  }
}

/**
 * Resolve retained/created encroachment multipliers into ordered unit factors
 * and the matching return fields. Created uses required lookups; retained
 * treats null / empty as no encroachment (multiplier 1).
 *
 * @param {{ watercourseEncroachment: string | null, riparianEncroachment: string | null }} encroachment
 * @param {{ required: boolean }} options
 * @returns {{ factors: number[], fields: { waterEncroachmentMultiplier: number, riparianEncroachmentMultiplier: number } }}
 */
function resolveWatercourseEncroachmentFactors(encroachment, { required }) {
  const resolve = required
    ? resolveRequiredEncroachmentMultiplier
    : resolveEncroachmentMultiplier
  const waterEncroachmentMultiplier = resolve(
    encroachment.watercourseEncroachment,
    WATERCOURSE_ENCROACHMENT_MULTIPLIER,
    WATERCOURSE_ENCROACHMENT_LOOKUP_LABEL
  )
  const riparianEncroachmentMultiplier = resolve(
    encroachment.riparianEncroachment,
    WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
    RIPARIAN_ENCROACHMENT_LOOKUP_LABEL
  )
  return {
    factors: [waterEncroachmentMultiplier, riparianEncroachmentMultiplier],
    fields: { waterEncroachmentMultiplier, riparianEncroachmentMultiplier }
  }
}

/**
 * Resolve enhanced post-intervention encroachment multipliers into ordered unit
 * factors and the matching `postIntervention*` return fields.
 *
 * @param {{ watercourseEncroachment: string | null, riparianEncroachment: string | null }} encroachment
 * @returns {{ factors: number[], fields: { postInterventionWaterEncroachmentMultiplier: number, postInterventionRiparianEncroachmentMultiplier: number } }}
 */
function resolveEnhancedWatercourseEncroachmentFactors(encroachment) {
  const postInterventionWaterEncroachmentMultiplier =
    resolveEncroachmentMultiplier(
      encroachment.watercourseEncroachment,
      WATERCOURSE_ENCROACHMENT_MULTIPLIER,
      WATERCOURSE_ENCROACHMENT_LOOKUP_LABEL
    )
  const postInterventionRiparianEncroachmentMultiplier =
    resolveEncroachmentMultiplier(
      encroachment.riparianEncroachment,
      WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
      RIPARIAN_ENCROACHMENT_LOOKUP_LABEL
    )
  return {
    factors: [
      postInterventionWaterEncroachmentMultiplier,
      postInterventionRiparianEncroachmentMultiplier
    ],
    fields: {
      postInterventionWaterEncroachmentMultiplier,
      postInterventionRiparianEncroachmentMultiplier
    }
  }
}

/** @type {import('./linear-post-intervention.js').LinearPostInterventionConfig} */
const WATERCOURSE_PI_CONFIG = {
  label: 'Watercourse',
  resolverLabel: WATERCOURSE_RESOLVER_LABEL,
  distinctivenessCategories: WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  distinctivenessScores: WATERCOURSE_DISTINCTIVENESS_SCORES,
  conditionScores: WATERCOURSE_CONDITION_SCORES,
  getCreationTimeMultiplier: getWatercourseCreationTimeMultiplier,
  getCreationDifficultyMultiplier: getWatercourseCreationDifficultyMultiplier,
  resolveEnhancementMultipliers: resolveWatercourseEnhancementMultipliers,
  resolveEncroachmentFactors: resolveWatercourseEncroachmentFactors,
  resolveEnhancedEncroachmentFactors:
    resolveEnhancedWatercourseEncroachmentFactors
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
  return calculateRetainedLinearPostIntervention(WATERCOURSE_PI_CONFIG, {
    lengthKm,
    type: watercourseType,
    condition,
    encroachment: { watercourseEncroachment, riparianEncroachment }
  })
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
  return calculateCreatedLinearPostIntervention(WATERCOURSE_PI_CONFIG, {
    lengthKm,
    type: watercourseType,
    condition,
    advanceYears,
    delayYears,
    encroachment: { watercourseEncroachment, riparianEncroachment }
  })
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
 * @throws {BaselineLookupError} If watercourse type, condition, or encroachment is not found in the reference tables
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
  return calculateEnhancedLinearPostIntervention(WATERCOURSE_PI_CONFIG, {
    baselineLengthKm,
    postInterventionLengthKm,
    baselineType: baselineWatercourseType,
    postType: postInterventionWatercourseType,
    baselineCondition,
    postCondition: postInterventionCondition,
    advanceYears,
    delayYears,
    encroachment: {
      watercourseEncroachment: postInterventionWatercourseEncroachment,
      riparianEncroachment: postInterventionRiparianEncroachment
    }
  })
}
