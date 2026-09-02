/**
 * Habitat sizing, taken off the back of the validation pass.
 *
 * `services/upload/calculate-habitat-sizes.js` sends the same geometry to
 * PostGIS a second time, purely to get `ST_Area` / `ST_Length` per feature —
 * a fourth parse of shapes that have already been parsed, repaired and
 * measured. By the time the checks have run, the worker is holding the repaired
 * geometry for every one of those features, so the numbers cost a pointer
 * dereference each.
 *
 * The sizes are keyed by the feature's position within its layer, not by
 * `featureId`: ids are assigned on the main thread *after* validation (see
 * assign-feature-ids.js), so the worker has no id to key on. Mapping position
 * to id happens where the ids are, in calculate-habitat-sizes.js.
 *
 * Both engines measure the MakeValid-repaired geometry, matching the SQL's
 * `ST_Area(ST_MakeValid(geom))` / `ST_Length(ST_MakeValid(geom))`.
 */

/** The layers the project document records a size for. */
export const SIZED_LAYERS = Object.freeze([
  'areas',
  'hedgerows',
  'watercourses'
])

/**
 * Per-feature areas (for `areas`) and lengths (for the linear layers).
 *
 * @param {Record<string, import('./geometry.js').LoadedFeature[]>} layers
 * @param {import('./geos-runtime.js').GeosRuntime} runtime
 * @returns {Record<string, Array<{ idx: number, value: number }>>}
 */
export function measureLayers(layers, runtime) {
  const sizes = {}
  for (const layerName of SIZED_LAYERS) {
    const measure = layerName === 'areas' ? runtime.area : runtime.length
    sizes[layerName] = (layers[layerName] ?? []).map((feature) => ({
      idx: feature.idx,
      value: measure(feature.valid)
    }))
  }
  return sizes
}
