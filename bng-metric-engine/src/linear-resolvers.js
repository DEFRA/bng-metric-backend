import { BaselineLookupError } from './errors.js'

/** Multiplier applied when encroachment is absent or null — equivalent to no penalty. */
export const DEFAULT_ENCROACHMENT_MULTIPLIER = 1

/**
 * Returns true when the post-intervention distinctiveness score is higher than baseline,
 * indicating a distinctiveness-uplifting enhancement.
 *
 * @param {number} baselineDistinctivenessScore
 * @param {number} postInterventionDistinctivenessScore
 * @returns {boolean}
 */
export function isDistinctivenessEnhancement(
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore
) {
  return postInterventionDistinctivenessScore > baselineDistinctivenessScore
}

/**
 * @param {string} habitatType
 * @param {Record<string, string>} categoryMap
 * @param {Record<string, { Score: number }>} scoresMap
 * @param {string} label - e.g. "hedgerow" or "watercourse"
 * @returns {{ distinctiveness: string, distinctivenessScore: number }}
 */
export function resolveLinearDistinctiveness(
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
export function resolveLinearConditionScore(
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
 * @param {string} char
 * @returns {boolean}
 */
function isWhitespaceChar(char) {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f' ||
    char === '\v'
  )
}

/**
 * Strip a leading "N. " numeric list prefix without regex backtracking.
 *
 * @param {string} value
 * @returns {string}
 */
function stripLeadingNumericPrefix(value) {
  let index = 0
  while (index < value.length && value[index] >= '0' && value[index] <= '9') {
    index += 1
  }
  if (index === 0 || index >= value.length || value[index] !== '.') {
    return value
  }
  index += 1
  while (index < value.length && isWhitespaceChar(value[index])) {
    index += 1
  }
  return value.slice(index)
}

/**
 * Collapse whitespace around "/" separators without regex backtracking.
 *
 * @param {string} value
 * @returns {string}
 */
function collapseSlashSpacing(value) {
  if (!value.includes('/')) {
    return value
  }
  return value
    .split('/')
    .map((part) => part.trim())
    .join('/')
}

/**
 * Normalise an encroachment label from GeoPackage exports before lookup.
 * Strips a leading numeric prefix (e.g. "2. Minor" → "Minor") and collapses
 * spaces around "/" (e.g. "3. Minor/ No Encroachment" → "Minor/No Encroachment").
 * Uses linear-time string parsing rather than backtracking regex to prevent ReDoS.
 *
 * @param {string} value
 * @returns {string}
 */
export function normaliseEncroachmentLabel(value) {
  return collapseSlashSpacing(stripLeadingNumericPrefix(value.trim()))
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
export function resolveEncroachmentMultiplier(value, lookupMap, label) {
  if (value == null || value === '') {
    return DEFAULT_ENCROACHMENT_MULTIPLIER
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
 * Like resolveEncroachmentMultiplier but rejects null, undefined, and empty string.
 *
 * @param {string} value
 * @param {Record<string, number>} lookupMap
 * @param {string} label - used in error messages
 * @returns {number}
 */
export function resolveRequiredEncroachmentMultiplier(value, lookupMap, label) {
  if (value == null || value === '') {
    throw new BaselineLookupError(`${label} is required`)
  }
  return resolveEncroachmentMultiplier(value, lookupMap, label)
}

/**
 * Resolve which length (km) applies to post-intervention and baseline value
 * terms for an enhanced linear habitat. When post-intervention length exceeds
 * baseline length, the post value uses the post-intervention length and the
 * baseline value uses the baseline length.
 *
 * @param {number} baselineLengthKm
 * @param {number} postInterventionLengthKm
 * @returns {{ postInterventionLengthKm: number, baselineLengthKm: number }}
 */
export function resolveEnhancedLinearLengths(
  baselineLengthKm,
  postInterventionLengthKm
) {
  if (postInterventionLengthKm <= baselineLengthKm) {
    return {
      postInterventionLengthKm,
      baselineLengthKm: postInterventionLengthKm
    }
  }
  return { postInterventionLengthKm, baselineLengthKm }
}

/**
 * @param {number} lengthKm
 * @param {string} label
 */
export function validateLinearLength(lengthKm, label) {
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
