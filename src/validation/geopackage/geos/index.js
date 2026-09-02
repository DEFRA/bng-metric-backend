/**
 * Geometry validation run in-process with GEOS compiled to WebAssembly.
 *
 * The second engine behind the seam `validation/geopackage/index.js` already
 * had: same fifteen error codes, same tolerances, same payloads, no database
 * connection. GEOS is the library PostGIS calls, so this is not a
 * reimplementation of the geometry — it is the same geometry, reached without a
 * round trip to a resource the service cannot scale horizontally.
 *
 * Two things it deliberately does NOT do:
 *
 *  - build its own error messages. `error-builders.js` renders every one of
 *    them, and it is the same module — and the same wording — the PostGIS engine
 *    used before it was removed. The verdicts it produced for the whole
 *    example-files corpus are recorded in
 *    integration-tests/fixtures/postgis-geometry-verdicts.json and asserted
 *    against on every run.
 *  - run on the main thread in production. GEOS is synchronous C code; a
 *    5,000-parcel file measured 2,344 ms of event-loop lag when run inline.
 *    `worker-pool.js` is how it is meant to be called. This entry point is
 *    synchronous-by-design so the worker, the unit tests and the parity suite
 *    can all drive it directly.
 */
import { ERROR_BUILDERS } from '../error-builders.js'
import { LAYER_NAMES } from '../geometry-constants.js'
import { ERROR_CODES } from '../errors.js'
import { loadGeosRuntime } from './geos-runtime.js'
import { freeLayers, loadLayer } from './geometry.js'
import { runChecks } from './checks.js'
import { measureLayers } from './sizes.js'

/**
 * Emission order for the error list. Identical to the PostGIS engine's, which
 * in turn matches the original Turf-engine sequence — so a file rejected for
 * several reasons lists them the same way whichever engine looked at it.
 */
const ERROR_ORDER = [
  ERROR_CODES.NO_REDLINE,
  ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
  ERROR_CODES.REDLINE_AREA_TOO_LARGE,
  ERROR_CODES.NO_HABITAT_AREAS,
  ERROR_CODES.REDLINE_INVALID_GEOMETRY,
  ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
  ERROR_CODES.PARCEL_OVERLAPS,
  ERROR_CODES.AREA_PARCELS_TOO_SMALL,
  ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
  ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
  ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
  ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
  ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
  ERROR_CODES.TREES_OUTSIDE_REDLINE,
  ERROR_CODES.AREA_SUM_MISMATCH
]

/**
 * Run every baseline geometry check against parsed layers, using GEOS-WASM.
 *
 * Takes no database handle of any kind. Everything below is GEOS arithmetic on
 * geometry this thread already holds.
 *
 * @param {object} layers output of readGeoPackage
 * @param {object} [options]
 * @param {boolean} [options.includeSizes] also return per-feature areas and
 *   lengths, so the sizing pass does not have to re-measure the same geometry
 * @returns {Promise<{
 *   valid: boolean,
 *   errors: Array<{ code: string, message: string }>,
 *   sizes?: Record<string, Array<{ idx: number, value: number }>>,
 *   geosVersion: string
 * }>}
 */
export async function validateGeoPackageLayersGeos(layers, options = {}) {
  const runtime = await loadGeosRuntime()
  const loaded = {}
  let payloads
  let sizes

  try {
    for (const layerName of LAYER_NAMES) {
      loaded[layerName] = loadLayer(layers[layerName], runtime)
    }
    payloads = runChecks(loaded, runtime)
    if (options.includeSizes) {
      sizes = measureLayers(loaded, runtime)
    }
  } finally {
    // Owned WebAssembly memory, so `finally` rather than a happy-path free: a
    // throwing check would otherwise leak the whole file's geometry into a
    // worker that goes on to serve every later upload.
    freeLayers(loaded, runtime)
  }

  const errors = ERROR_ORDER.filter((code) => payloads.has(code)).map((code) =>
    ERROR_BUILDERS[code](payloads.get(code))
  )

  return {
    valid: errors.length === 0,
    errors,
    ...(sizes ? { sizes } : {}),
    geosVersion: runtime.version
  }
}
