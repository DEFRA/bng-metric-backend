/**
 * Turning parsed GeoPackage layers into GEOS geometries, and the spatial
 * bookkeeping the SQL engine gets from PostgreSQL for free.
 *
 * Two things PostGIS supplies that have to be built by hand here:
 *
 *  - *reprojection*. The SQL wraps every feature in `ST_Transform(..., 27700)`;
 *    here it is proj4js, applied to the GeoJSON before GEOS ever sees it
 *    (see reproject.js).
 *  - *candidate pruning for the overlap self-join*. The SQL materialises the
 *    parcels into a GiST-indexed temp table so the planner compares bounding
 *    boxes before running the exact predicate. `candidatePairs` below is a
 *    sweep-line over the same bounding boxes, producing the same candidate set.
 *
 * Every geometry allocated here is owned by the returned {@link LoadedLayer}
 * and must be released with {@link freeLayers}.
 */
import { toBritishNationalGrid } from './reproject.js'

/**
 * @typedef {object} LoadedFeature
 * @property {number} idx position within its layer's feature array — the value
 *   reported as `idx` in error payloads, and the same number the PostGIS
 *   engine reports, which is why it is the *array* index and not a count of
 *   the features that survived the geometry filter
 * @property {string|null} fid the SQLite primary key, as a string
 * @property {string|null} featureRef Parcel Ref / Tree Ref / Baseline Parcel Ref
 * @property {number} geom GEOS pointer to the geometry as supplied
 * @property {number} valid GEOS pointer to the MakeValid-repaired geometry
 * @property {number[]} bbox [minX, minY, maxX, maxY] in EPSG:27700
 */

/**
 * Resolve a feature's user-facing reference column. Different layers carry the
 * value under different property names: Parcel Ref (Habitats / Hedgerows /
 * Rivers), Tree Ref (Urban Trees), Baseline Parcel Ref (Water course
 * enhancement...). The SQL side does exactly this with a COALESCE; null flows
 * through to the shared `describeFeature` helper, which falls back to fid and
 * then to the layer-relative position.
 *
 * @param {object} properties
 * @returns {string|null}
 */
function featureRefOf(properties) {
  return (
    properties?.['Parcel Ref'] ??
    properties?.['Tree Ref'] ??
    properties?.['Baseline Parcel Ref'] ??
    null
  )
}

/**
 * The SQLite primary key, stringified. The SQL reads it out of JSONB with
 * `props->>'fid'`, which yields text, so a numeric fid arrives on the Node side
 * as a string — matched here so both engines produce the same payload type.
 *
 * @param {object} properties
 * @returns {string|null}
 */
function fidOf(properties) {
  const fid = properties?.fid
  return fid == null ? null : String(fid)
}

/**
 * Bounding box of a GeoJSON geometry, in the geometry's own units.
 *
 * @param {object} geometry
 * @returns {number[]} [minX, minY, maxX, maxY]
 */
export function bbox(geometry) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const walk = (coordinates) => {
    if (typeof coordinates[0] === 'number') {
      const [x, y] = coordinates
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      return
    }
    for (const child of coordinates) {
      walk(child)
    }
  }

  walk(geometry.coordinates)
  return [minX, minY, maxX, maxY]
}

/**
 * Slots in a bounding box — the flat `[minX, minY, maxX, maxY]` that `bbox`
 * above returns. Named because a sweep line comparing one box's maxX against
 * another's minX is unreadable as bare subscripts.
 */
const MIN_X = 0
const MIN_Y = 1
const MAX_X = 2
const MAX_Y = 3

/**
 * Every pair of features whose bounding boxes overlap — the candidate set the
 * exact overlap test then runs against.
 *
 * This is what replaces the GiST index. A sweep line advances through the boxes
 * in ascending minX, keeping an "active" set of boxes whose maxX has not yet
 * been passed; each new box is tested for Y-overlap against the active set
 * only. That is O(n log n + k) for k reported pairs, against the O(n^2) every
 * pair the naive self-join would compare — and it reproduces the index's
 * candidate set exactly, because a GiST bounding-box scan reports precisely the
 * pairs whose boxes intersect.
 *
 * Pairs come back with the lower index first, so the caller's `idx_a < idx_b`
 * ordering matches the SQL's.
 *
 * @param {number[][]} boxes bounding boxes, indexed as the caller's features are
 * @returns {Array<[number, number]>}
 */
export function candidatePairs(boxes) {
  const byMinX = boxes
    .map((_, index) => index)
    .sort((a, b) => boxes[a][MIN_X] - boxes[b][MIN_X])
  const pairs = []
  const active = []

  for (const index of byMinX) {
    const box = boxes[index]
    for (let slot = active.length - 1; slot >= 0; slot--) {
      const other = active[slot]
      if (boxes[other][MAX_X] < box[MIN_X]) {
        // Swept past this box's maxX: it can never overlap anything further
        // along, so drop it by swapping in the tail rather than splicing.
        active[slot] = active.at(-1)
        active.pop()
        continue
      }
      if (
        boxes[other][MIN_Y] <= box[MAX_Y] &&
        boxes[other][MAX_Y] >= box[MIN_Y]
      ) {
        pairs.push(index < other ? [index, other] : [other, index])
      }
    }
    active.push(index)
  }

  return pairs
}

/**
 * Load one layer's features into GEOS.
 *
 * Features without geometry are skipped, exactly as the PostGIS engine's
 * `buildArrays` skips them — and, as there, the surviving features keep their
 * original array position as `idx`.
 *
 * Both the geometry as supplied and its MakeValid repair are kept: the SQL uses
 * one or the other check by check (totals and linear differences read the raw
 * geometry; overlaps, areas and containment read the repaired one), and getting
 * that split wrong is the easiest way to diverge from it.
 *
 * @param {object[]} features
 * @param {import('./geos-runtime.js').GeosRuntime} runtime
 * @returns {LoadedFeature[]}
 */
export function loadLayer(features, runtime) {
  const loaded = []

  ;(features ?? []).forEach((feature, idx) => {
    if (!feature?.nativeGeometry) {
      return
    }
    const projected = toBritishNationalGrid(
      feature.nativeGeometry,
      feature.nativeSrid
    )
    const geom = runtime.fromGeoJson(projected)
    loaded.push({
      idx,
      fid: fidOf(feature.properties),
      featureRef: featureRefOf(feature.properties),
      geom,
      valid: runtime.makeValid(geom),
      bbox: bbox(projected)
    })
  })

  return loaded
}

/**
 * Release every GEOS geometry held by a loaded layer set.
 *
 * @param {Record<string, LoadedFeature[]>} layers
 * @param {import('./geos-runtime.js').GeosRuntime} runtime
 */
export function freeLayers(layers, runtime) {
  for (const features of Object.values(layers)) {
    for (const feature of features) {
      runtime.free(feature.geom)
      runtime.free(feature.valid)
    }
  }
}
