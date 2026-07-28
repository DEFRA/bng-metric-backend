import { BaselineLookupError } from './errors.js' // NOSONAR: thrown in validateHabitat/validateCondition (S1128 false positive)
import {
  CONDITION_SCORES,
  DISTINCTIVENESS_CATEGORIES,
  DISTINCTIVENESS_SCORES,
  HABITAT_DIFFICULTY,
  TIME_TO_TARGET_MULTIPLIER
} from './reference-constants.js'

/** Minimum delay/advance years accepted by the statutory multiplier tables. */
export const MIN_YEARS = 0

/** Maximum delay/advance years accepted by the statutory multiplier tables. */
export const MAX_YEARS = 30

/** Legacy string alias for {@link MAX_YEARS} in metric inputs. */
export const MAX_YEARS_PLUS = '30+'

/** Time-to-target bucket key when computed years exceed {@link MAX_YEARS}. */
export const OVER_MAX_YEARS = '>30'

/** Keys accepted for delay/advance years (integers 0–30 per multiplier table). */
const VALID_YEAR_KEYS = new Set(Object.keys(TIME_TO_TARGET_MULTIPLIER))

/** Change-type keys present on habitat difficulty rows (e.g. Creation, Enhancement). */
const VALID_HABITAT_CHANGE_TYPES = new Set(
  Object.values(HABITAT_DIFFICULTY).flatMap((entry) =>
    entry && typeof entry === 'object' ? Object.keys(entry) : []
  )
)

/** Safe for error messages when `years` may be an object or other non-primitive. */
function formatYearsForMessage(years) {
  if (typeof years === 'string') {
    return JSON.stringify(years)
  }
  if (typeof years === 'number' || typeof years === 'boolean') {
    return String(years)
  }
  if (years === null) {
    return 'null'
  }
  if (typeof years === 'bigint') {
    return `${years.toString()}n`
  }
  if (typeof years === 'symbol') {
    const d = years.description
    return d === undefined ? 'Symbol()' : `Symbol(${JSON.stringify(d)})`
  }
  try {
    return JSON.stringify(years)
  } catch {
    return Object.prototype.toString.call(years)
  }
}

/**
 * Validate the size parameter
 * @param {number} size - The size of the habitat
 * @throws {Error} If size is not a finite number greater than 0
 */
export function validateSize(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    throw new Error('Size must be a finite number greater than 0')
  }
}

/**
 * Validate the habitat parameter
 * @param {string} habitat - The habitat name (e.g., "Grassland - Bracken")
 * @throws {Error} If habitat is not a string or is not a valid habitat
 */
export function validateHabitat(habitat) {
  if (habitat === null || habitat === undefined || habitat === '') {
    throw new Error('habitat not specified')
  }
  if (typeof habitat !== 'string') {
    throw new TypeError(`Habitat must be a string, got ${typeof habitat}`)
  }
  if (!Object.hasOwn(DISTINCTIVENESS_CATEGORIES, habitat)) {
    throw new BaselineLookupError(`Habitat '${habitat}' is not a valid habitat`)
  }
  const category = DISTINCTIVENESS_CATEGORIES[habitat]
  if (
    typeof category !== 'string' ||
    !Object.hasOwn(DISTINCTIVENESS_SCORES, category)
  ) {
    throw new Error(
      `Habitat '${habitat}' has no distinctiveness category in reference data`
    )
  }
}

/**
 * Validate the condition parameter
 * @param {string} habitat - The habitat name (e.g., "Grassland - Bracken")
 * @param {string} condition - The condition name (e.g., "Moderate")
 * @throws {Error} If condition is not a string or is not a valid condition for the habitat
 */
export function validateCondition(habitat, condition) {
  if (condition === null || condition === undefined || condition === '') {
    throw new Error('condition not specified')
  }
  if (typeof condition !== 'string') {
    throw new TypeError(`Condition must be a string, got ${typeof condition}`)
  }
  validateHabitat(habitat)

  const row = CONDITION_SCORES[habitat]
  if (!row || typeof row !== 'object') {
    throw new Error(`No condition reference data for habitat: ${habitat}`)
  }
  if (!Object.hasOwn(row, condition)) {
    throw new BaselineLookupError(
      `Condition '${condition}' is not a valid condition for habitat: ${habitat}`
    )
  }
}

function yearsRangeMessage() {
  return `Expected an integer from ${MIN_YEARS} to ${MAX_YEARS}`
}

/**
 * @param {unknown} years
 * @returns {number}
 */
function parseYearsNumber(years) {
  if (typeof years === 'string') {
    const trimmed = years.trim()
    if (trimmed === '') {
      throw new Error(`years value is empty`)
    }
    if (!/^\d+$/u.test(trimmed)) {
      throw new Error(
        `${formatYearsForMessage(years)} is not a valid value for years. ${yearsRangeMessage()} as a number or numeric string (legacy alias '${MAX_YEARS_PLUS}' is accepted).`
      )
    }
    return Number(trimmed)
  }
  if (typeof years === 'number') {
    return years
  }
  throw new TypeError(
    `${formatYearsForMessage(years)} is not a valid value for years. ${yearsRangeMessage()}.`
  )
}

/**
 * @param {unknown} years
 * @param {number} n
 */
function assertYearsInStatutoryRange(years, n) {
  if (!Number.isInteger(n) || n < MIN_YEARS || n > MAX_YEARS) {
    throw new Error(
      `${formatYearsForMessage(years)} is not a valid number for years. ${yearsRangeMessage()}.`
    )
  }
}

/**
 * @param {unknown} years
 * @param {number} n
 */
function assertYearsInReferenceTable(years, n) {
  if (!VALID_YEAR_KEYS.has(String(n))) {
    throw new Error(
      `${formatYearsForMessage(years)} is not listed in the time-to-target multiplier reference data.`
    )
  }
}

/**
 * @param {string} changeType - The type of habitat change (e.g., "Creation" or "Enhancement")
 * @throws {Error} If changeType is not a string or is not a valid change type
 */
export function validateHabitatChange(changeType) {
  if (changeType === null || changeType === undefined || changeType === '') {
    throw new Error('changeType not specified')
  }
  if (typeof changeType !== 'string') {
    throw new TypeError(`changeType must be a string, got ${typeof changeType}`)
  }
  if (!VALID_HABITAT_CHANGE_TYPES.has(changeType)) {
    throw new Error(
      `Habitat change type '${changeType}' is not a valid change type`
    )
  }
}

/**
 * @param {unknown} years - Delay or advance years (integer {@link MIN_YEARS}–{@link MAX_YEARS}, or legacy string forms)
 * @returns {number} Normalised integer years in {@link MIN_YEARS}–{@link MAX_YEARS}
 * @throws {Error} If years is not allowed by {@link TIME_TO_TARGET_MULTIPLIER} keys for {@link MIN_YEARS}–{@link MAX_YEARS}.
 */
export function validateYears(years) {
  if (years === null || years === undefined) {
    throw new Error('years not specified')
  }

  if (years === MAX_YEARS_PLUS) {
    return MAX_YEARS
  }

  const n = parseYearsNumber(years)
  assertYearsInStatutoryRange(years, n)
  assertYearsInReferenceTable(years, n)
  return n
}

/**
 * Validate the advance/delay pair for a single habitat parcel.
 *
 * Statutory tool: advance and delayed creation cannot both be used on the same
 * habitat. Staggered creation is expressed as two rows, so the pair is rejected
 * rather than netted into a single figure.
 *
 * @param {unknown} advanceYears
 * @param {unknown} delayYears
 * @returns {{ validatedAdvanceYears: number, validatedDelayYears: number }}
 * @throws {Error} If either value is invalid, or if both are non-zero.
 */
export function validateAdvanceAndDelayYears(advanceYears, delayYears) {
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)

  if (validatedAdvanceYears > MIN_YEARS && validatedDelayYears > MIN_YEARS) {
    throw new Error(
      `Advance (${validatedAdvanceYears}) and delay (${validatedDelayYears}) years cannot both be used on the same habitat. Use one or the other, or split the habitat across two parcels.`
    )
  }

  return { validatedAdvanceYears, validatedDelayYears }
}
