import { BaselineLookupError } from './errors.js'
import { roundToSigFigs } from './utils.js'
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
 * @param {string} habitatType
 * @param {Record<string, string>} categoryMap
 * @param {Record<string, { Score: number }>} scoresMap
 * @param {string} label - e.g. "hedgerow" or "watercourse"
 * @returns {{ distinctiveness: string, distinctivenessScore: number }}
 */
function resolveLinearDistinctiveness(
  habitatType,
  categoryMap,
  scoresMap,
  label
) {
  if (!habitatType || typeof habitatType !== 'string') {
    throw new BaselineLookupError(`${label} type must be a non-empty string`)
  }
  const distinctiveness = categoryMap[habitatType]
  if (!distinctiveness) {
    throw new BaselineLookupError(
      `Distinctiveness not found for ${label} type: ${habitatType}`
    )
  }
  const scoreRow = scoresMap[distinctiveness]
  if (!scoreRow || typeof scoreRow.Score !== 'number') {
    throw new BaselineLookupError(
      `Distinctiveness score not found for band: ${distinctiveness}`
    )
  }
  return { distinctiveness, distinctivenessScore: scoreRow.Score }
}

/**
 * @param {string} habitatType
 * @param {string} condition
 * @param {Record<string, Record<string, number | string>>} conditionScoresByType
 * @param {string} label - e.g. "hedgerow" or "watercourse"
 * @returns {number}
 */
function resolveLinearConditionScore(
  habitatType,
  condition,
  conditionScoresByType,
  label
) {
  if (!condition || typeof condition !== 'string') {
    throw new BaselineLookupError(
      `${label} condition must be a non-empty string`
    )
  }
  const typeScores = conditionScoresByType[habitatType]
  if (!typeScores) {
    throw new BaselineLookupError(
      `Condition scores not found for ${label} type: ${habitatType}`
    )
  }
  const score = typeScores[condition]
  if (typeof score !== 'number') {
    throw new BaselineLookupError(
      `Condition score not found for ${label} condition: ${condition}`
    )
  }
  return score
}

/**
 * Strip a leading numeric prefix from an encroachment label
 * (e.g. "1. Major/Moderate" → "Major/Moderate").
 *
 * @param {string} value
 * @returns {string}
 */
function normaliseEncroachmentLabel(value) {
  return value.trim().replace(/^\d+\.\s+/u, '')
}

/**
 * Whether an encroachment value is absent or maps to a known multiplier.
 * Null, undefined, and empty string are treated as recognised (multiplier 1).
 *
 * @param {unknown} value
 * @param {Record<string, number>} lookupMap
 * @returns {boolean}
 */
export function isRecognisedEncroachmentValue(value, lookupMap) {
  if (value == null || value === '') {
    return true
  }
  if (typeof value !== 'string') {
    return false
  }
  return typeof lookupMap[normaliseEncroachmentLabel(value)] === 'number'
}

/**
 * Look up an encroachment multiplier, stripping any leading numeric prefix
 * (e.g. "1. Major/Moderate" → "Major/Moderate") before the lookup.
 * Returns 1 when value is null / undefined / empty string.
 *
 * @param {string | null | undefined} value
 * @param {Record<string, number>} lookupMap
 * @param {string} label - used in error messages
 * @returns {number}
 */
function resolveEncroachmentMultiplier(value, lookupMap, label) {
  if (value == null || value === '') {
    return 1
  }
  if (typeof value !== 'string') {
    throw new BaselineLookupError(`${label} must be a string`)
  }
  const multiplier = lookupMap[normaliseEncroachmentLabel(value)]
  if (typeof multiplier !== 'number') {
    throw new BaselineLookupError(
      `Encroachment multiplier not found for ${label}: ${value}`
    )
  }
  return multiplier
}

/**
 * @param {number} lengthKm
 * @param {string} label
 */
function validateLinearLength(lengthKm, label) {
  if (
    typeof lengthKm !== 'number' ||
    !Number.isFinite(lengthKm) ||
    lengthKm <= 0
  ) {
    throw new TypeError(
      `${label} length must be a positive finite number (km), got: ${lengthKm}`
    )
  }
}

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
