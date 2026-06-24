import { roundToSigFigs } from './utils.js'
import {
  resolveEncroachmentMultiplier,
  resolveLinearConditionScore,
  resolveLinearDistinctiveness,
  validateLinearLength
} from './linear-resolvers.js'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from './reference-constants.js'

/** Metric uses 1 for baseline */
const BASELINE_STRATEGIC_SIGNIFICANCE_MULTIPLIER = 1

/**
 * Get hedgerow baseline biodiversity units for a given length, hedge type,
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
export function calculateHedgerowBaseline(lengthKm, hedgeType, condition) {
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
  const strategicSignificanceScore = BASELINE_STRATEGIC_SIGNIFICANCE_MULTIPLIER

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
 * Get watercourse baseline biodiversity units for a given length,
 * watercourse type, condition, and encroachment values.
 *
 * @param {number} lengthKm - Length in kilometres
 * @param {string} watercourseType - Watercourse type (e.g. "Priority habitat")
 * @param {string} condition - Condition band (e.g. "Good", "Moderate")
 * @param {string | null} [watercourseEncroachment] - Encroachment into watercourse (e.g. "Minor")
 * @param {string | null} [riparianEncroachment] - Encroachment into riparian zone (e.g. "1. Minor/No Encroachment"); leading numeric prefix is stripped automatically
 * @returns {{ units: number, distinctiveness: string, distinctivenessScore: number, conditionScore: number, waterEncroachmentMultiplier: number, riparianEncroachmentMultiplier: number, strategicSignificanceScore: number }}
 * @throws {TypeError} If length is invalid
 * @throws {BaselineLookupError} If any lookup key is not found in the reference tables
 */
export function calculateWatercourseBaseline(
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
    'watercourse encroachment'
  )
  const riparianEncroachmentMultiplier = resolveEncroachmentMultiplier(
    riparianEncroachment,
    WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
    'riparian encroachment'
  )
  const strategicSignificanceScore = BASELINE_STRATEGIC_SIGNIFICANCE_MULTIPLIER

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

export {
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES
}
