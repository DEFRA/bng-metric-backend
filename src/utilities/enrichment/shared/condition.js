// QGIS / statutory tool condition labels are often prefixed with an index
// (e.g. "6. N/A - Other"). Engine keys and reference data use the suffix only
// ("N/A - Other"), so the prefix must be stripped before persistence,
// reference comparison, or engine lookup.

/**
 * Strip the leading "N. " list-index prefix from a condition label and trim
 * surrounding whitespace. Non-strings pass through unchanged so absent
 * conditions (null / undefined) remain absent.
 *
 * @param {unknown} condition
 * @returns {string | unknown}
 */
export function stripConditionPrefix(condition) {
  if (typeof condition !== 'string') {
    return condition
  }
  return condition.trim().replace(/^\d+\.\s+/u, '')
}
