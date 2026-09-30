/**
 * Habitat sizing, taken off the back of the validation pass.
 *
 * Each feature's area or length is the size its units are priced on, so it is
 * measured with bng-library/measure — the one definition of a feature's size,
 * which the metric workbooks the service is compared with are measured with
 * too. GEOS stays for the validation checks; it no longer decides sizes.
 *
 * What is measured is the geometry as supplied, in British National Grid, not
 * its MakeValid repair: a file with an invalid area parcel is refused, so every
 * size that is ever priced belongs to a valid geometry, which the repair leaves
 * as it was.
 *
 * The sizes are keyed by the feature's position within its layer, not by
 * `featureId`: ids are assigned on the main thread *after* validation (see
 * assign-feature-ids.js), so the worker has no id to key on. Mapping position
 * to id happens where the ids are, in calculate-habitat-sizes.js.
 */

import { areaSquareMetres, lengthMetres } from 'bng-library/measure'

/** The layers the project document records a size for. */
export const SIZED_LAYERS = Object.freeze([
  'areas',
  'hedgerows',
  'watercourses'
])

/**
 * Per-feature areas in m² (for `areas`) and lengths in metres (for the linear
 * layers).
 *
 * @param {Record<string, import('./geometry.js').LoadedFeature[]>} layers
 * @returns {Record<string, Array<{ idx: number, value: number }>>}
 */
export function measureLayers(layers) {
  const sizes = {}
  for (const layerName of SIZED_LAYERS) {
    const measure = layerName === 'areas' ? areaSquareMetres : lengthMetres
    sizes[layerName] = (layers[layerName] ?? []).map((feature) => ({
      idx: feature.idx,
      value: measure(feature.projected)
    }))
  }
  return sizes
}
