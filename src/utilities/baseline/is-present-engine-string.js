/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPresentEngineString(value) {
  if (typeof value !== 'string' || value === '') {
    return false
  }
  return value.trim().toUpperCase() !== 'N/A'
}
