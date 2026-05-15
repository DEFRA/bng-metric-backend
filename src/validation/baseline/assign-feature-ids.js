import { randomUUID } from 'node:crypto'

/**
 * Stamp a fresh UUID `featureId` onto every feature in each layer array.
 * Returns a new layers object with cloned feature objects (originals untouched).
 *
 * Call this once before passing layers to both calculateHabitatSizes and
 * extractBaseline so both consumers share the same explicit join key rather
 * than relying on a fragile implicit array-position contract.
 *
 * @param {object} layers  The raw layers object from readBaselineGeoPackage.
 * @returns {object}       New layers object with featureId on every feature.
 */
export function assignFeatureIds(layers) {
  const result = {}
  for (const [layerName, features] of Object.entries(layers)) {
    result[layerName] = Array.isArray(features)
      ? features.map((f) => ({ ...f, featureId: randomUUID() }))
      : features
  }
  return result
}
