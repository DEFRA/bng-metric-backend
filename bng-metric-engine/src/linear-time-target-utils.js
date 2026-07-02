import {
  MAX_YEARS,
  MAX_YEARS_PLUS,
  MIN_YEARS,
  OVER_MAX_YEARS
} from './validate.js'

/** Sentinel numeric value used when computed years exceed MAX_YEARS in bucket arithmetic. */
export const MAX_YEARS_OVER_BUCKET = MAX_YEARS + 1

/**
 * Normalise a raw time-to-target reference value to a number.
 * Accepts the legacy "30+" string alias for MAX_YEARS.
 *
 * @param {number | string} timeToTargetValue
 * @returns {number}
 */
export function normaliseReferenceYears(timeToTargetValue) {
  if (timeToTargetValue === MAX_YEARS_PLUS) {
    return MAX_YEARS
  }
  if (typeof timeToTargetValue !== 'number') {
    throw new TypeError(
      `Reference time to target must be a number or "${MAX_YEARS_PLUS}", got: ${timeToTargetValue}`
    )
  }
  return timeToTargetValue
}

/**
 * Apply delay and advance to reference years and clamp to [MIN_YEARS, MAX_YEARS_OVER_BUCKET].
 *
 * @param {number} years
 * @param {number} validatedAdvanceYears
 * @param {number} validatedDelayYears
 * @returns {number}
 */
export function applyDelayAdvanceAndClamp(
  years,
  validatedAdvanceYears,
  validatedDelayYears
) {
  const computed = years + validatedDelayYears - validatedAdvanceYears
  if (computed < MIN_YEARS) {
    return MIN_YEARS
  }
  if (computed > MAX_YEARS) {
    return MAX_YEARS_OVER_BUCKET
  }
  return computed
}

/**
 * Convert numeric years to the string key used in time-to-target lookup tables.
 *
 * @param {number} years
 * @returns {string}
 */
export function toTimeToTargetBucketKey(years) {
  if (years > MAX_YEARS) {
    return OVER_MAX_YEARS
  }
  return String(years)
}

/**
 * Returns true when advanceYears meets or exceeds the years implied by timeToTargetKey.
 *
 * @param {number} advanceYears
 * @param {string} timeToTargetKey - e.g. "5", ">30"
 * @returns {boolean}
 */
export function advanceMeetsTimeToTarget(advanceYears, timeToTargetKey) {
  const targetYears =
    timeToTargetKey === OVER_MAX_YEARS
      ? MAX_YEARS_OVER_BUCKET
      : Number(timeToTargetKey)
  return advanceYears >= targetYears
}
