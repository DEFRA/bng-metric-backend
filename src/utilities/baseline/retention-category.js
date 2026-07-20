// Normalisation and assignment of post-intervention retention categories from the
// GeoPackage Retention Category column.

export const RETENTION_RETAINED = 'Retained'
export const RETENTION_CREATED = 'Created'
export const RETENTION_ENHANCED = 'Enhanced'

export const RETENTION_CATEGORY_VALUES = Object.freeze([
  RETENTION_RETAINED,
  RETENTION_CREATED,
  RETENTION_ENHANCED
])

/** Raw GPKG value before mapping area-habitat Lost to Created. */
export const GPKG_RETENTION_LOST = 'Lost'

/**
 * @param {string} char
 * @returns {boolean}
 */
function isAsciiDigit(char) {
  return char >= '0' && char <= '9'
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isHorizontalWhitespace(char) {
  return char === ' ' || char === '\t'
}

/**
 * @param {string} text
 * @returns {number}
 */
function indexAfterLeadingDigits(text) {
  let index = 0
  while (index < text.length && isAsciiDigit(text[index])) {
    index += 1
  }
  return index
}

/**
 * @param {string} text
 * @param {number} startIndex
 * @returns {number}
 */
function indexAfterLeadingWhitespace(text, startIndex) {
  let index = startIndex
  while (index < text.length && isHorizontalWhitespace(text[index])) {
    index += 1
  }
  return index
}

/**
 * @param {string} text
 * @param {number} digitEnd
 * @returns {boolean}
 */
function hasNumericListPrefix(text, digitEnd) {
  if (digitEnd === 0) {
    return false
  }
  if (digitEnd >= text.length) {
    return false
  }
  return text[digitEnd] === '.'
}

/**
 * Strip a leading "N. " numeric list prefix from a retention category string
 * (e.g. "1. Created" → "Created"). Uses linear string parsing to avoid ReDoS.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normaliseRetentionCategory(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  const digitEnd = indexAfterLeadingDigits(trimmed)
  if (hasNumericListPrefix(trimmed, digitEnd)) {
    const contentStart = indexAfterLeadingWhitespace(trimmed, digitEnd + 1)
    return trimmed.slice(contentStart)
  }
  return trimmed
}

/**
 * Map a raw GeoPackage Retention Category to one of the three persisted
 * retention categories. Area habitats with GPKG Lost are treated as Created
 * (replacement habitat). Hedgerows, watercourses, and trees with Lost are
 * excluded at extract time and never reach this mapping.
 *
 * @param {unknown} rawRetentionCategory
 * @returns {'Retained' | 'Created' | 'Enhanced' | null}
 */
export function deriveRetentionCategory(rawRetentionCategory) {
  const normalised = normaliseRetentionCategory(rawRetentionCategory)
  if (!normalised) {
    return null
  }
  if (normalised === RETENTION_RETAINED) {
    return RETENTION_RETAINED
  }
  if (normalised === RETENTION_CREATED) {
    return RETENTION_CREATED
  }
  if (normalised === RETENTION_ENHANCED) {
    return RETENTION_ENHANCED
  }
  if (normalised === GPKG_RETENTION_LOST) {
    return RETENTION_CREATED
  }
  return null
}

/**
 * True when the raw GPKG Retention Category is Lost (including "N. Lost").
 * Used to exclude hedgerows, watercourses, and trees at extract/sizing time.
 *
 * @param {unknown} rawRetentionCategory
 * @returns {boolean}
 */
export function isLostRetentionCategory(rawRetentionCategory) {
  return (
    normaliseRetentionCategory(rawRetentionCategory) === GPKG_RETENTION_LOST
  )
}

/**
 * Resolve the retention category for enrichment. Prefer the top-level
 * `retentionCategory`; fall back to legacy `baseline.retentionCategory`
 * for stored projects imported before the field moved to the feature root.
 *
 * @param {{ retentionCategory?: string, baseline?: { retentionCategory?: unknown } } | null | undefined} feature
 * @returns {'Retained' | 'Created' | 'Enhanced' | null}
 */
export function resolveRetentionCategory(feature) {
  if (
    typeof feature?.retentionCategory === 'string' &&
    RETENTION_CATEGORY_VALUES.includes(feature.retentionCategory)
  ) {
    return feature.retentionCategory
  }
  return deriveRetentionCategory(feature?.baseline?.retentionCategory)
}

/**
 * Stored post-intervention linear features imported before Lost-linear
 * exclusion may still carry legacy `baseline.retentionCategory: Lost`.
 *
 * @param {{ retentionCategory?: string, baseline?: { retentionCategory?: unknown } } | null | undefined} feature
 * @returns {boolean}
 */
export function isLegacyLostLinear(feature) {
  if (feature?.retentionCategory) {
    return false
  }
  return isLostRetentionCategory(feature?.baseline?.retentionCategory)
}
