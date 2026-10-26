/** Layer keys in a parsed GeoPackage that are not arrays of features. */
const NON_FEATURE_LAYER_KEYS = new Set(['missingLayers'])

/**
 * Total features parsed out of a GeoPackage, across every layer. This is the
 * scale figure that makes every duration interpretable — a 4 s validate
 * means nothing without knowing whether it covered 40 parcels or 40,000.
 *
 * @param {object} layers
 * @returns {number}
 */
export function countFeatures(layers) {
  let total = 0
  for (const [key, value] of Object.entries(layers ?? {})) {
    if (!NON_FEATURE_LAYER_KEYS.has(key) && Array.isArray(value)) {
      total += value.length
    }
  }
  return total
}
