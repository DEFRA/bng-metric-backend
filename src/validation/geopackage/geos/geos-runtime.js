/**
 * Lifecycle and low-level plumbing for GEOS compiled to WebAssembly.
 *
 * The `geos-wasm` package exposes the GEOS C API more or less verbatim, which
 * means out-parameters, raw pointers and manual frees. Everything ugly about
 * that lives here, so `checks.js` reads as fifteen geometry rules rather than
 * as memory management.
 *
 * One module-level instance per thread. Loading the module compiles ~2.5 MB of
 * embedded WebAssembly, so it is memoised and shared: in production each worker
 * thread has exactly one, and it stays warm for the life of the worker.
 *
 * NOTE on memory: WebAssembly linear memory grows to the high-water mark of the
 * work done and is never returned to the OS. A worker that has validated a
 * 10,000-parcel file keeps that footprint for its lifetime. That is measured
 * and expected (spike risk R6/R7) — it plateaus rather than leaking — but it is
 * why the worker pool is small and fixed.
 */
import initGeosJs from 'geos-wasm'
import { geojsonToGeosGeom } from 'geos-wasm/helpers'

import { createLogger } from '../../../common/helpers/logging/logger.js'

const logger = createLogger()

/** GEOS type id for a GEOMETRYCOLLECTION (GEOSGeomTypes). */
const GEOS_GEOMETRYCOLLECTION = 7

/** Bytes in an IEEE-754 double, for the GEOSArea / GEOSLength out-parameter. */
const DOUBLE_BYTES = 8

/** Bytes in a wasm32 pointer, for the GEOSisValidDetail out-parameters. */
const POINTER_BYTES = 4

/** log2 of DOUBLE_BYTES — HEAPF64 is indexed in doubles, so byte >> 3. */
const HEAPF64_SHIFT = 3

/** log2 of POINTER_BYTES — HEAPU32 is indexed in words, so byte >> 2. */
const HEAPU32_SHIFT = 2

/**
 * Flags argument to GEOSisValidDetail. 0 = default behaviour, matching what
 * PostGIS's single-argument ST_IsValidDetail(geom) asks for (the
 * ESRI-self-touching-ring allowance is flag 1, which PostGIS only sets when
 * explicitly asked).
 */
const VALID_DETAIL_DEFAULT_FLAGS = 0

/** WKT output is always 2D; the validator ignores Z/M entirely. */
const WKT_OUTPUT_DIMENSION = 2

/** Memoised across calls — see the module comment. */
let runtimePromise = null

/**
 * @typedef {object} GeosRuntime
 * @property {object} geos raw geos-wasm handle, for calls not wrapped here
 * @property {string} version GEOS version string, for the divergence logs (R4)
 * @property {(geometry: object) => number} fromGeoJson GeoJSON -> geometry pointer
 * @property {(g: number) => number} area
 * @property {(g: number) => number} length
 * @property {(g: number) => number} makeValid
 * @property {(g: number) => boolean} isValid
 * @property {(g: number) => { valid: boolean, reason: string|null, locationWkt: string|null }} validDetail
 * @property {(g: number) => string} toWkt
 * @property {(geoms: number[]) => number} unionAll union of a list of geometries
 * @property {(g: number) => void} free
 */

/**
 * Load (or return the already-loaded) GEOS runtime for this thread.
 *
 * @returns {Promise<GeosRuntime>}
 */
export function loadGeosRuntime() {
  runtimePromise ??= initGeosJs(GEOS_HANDLERS).then(buildRuntime)
  return runtimePromise
}

/**
 * GEOS reports two kinds of message through C callbacks, and geos-wasm's
 * defaults are wrong for a server: notices go to `console.log` (straight past
 * pino, unstructured, and noisy — a self-intersecting parcel emits one per
 * check) and errors throw a bare `Error` with no indication of where it came
 * from.
 *
 * Notices are diagnostic chatter about the geometry in the file, not about the
 * service, so they are logged at debug. Errors keep throwing — a GEOS failure
 * means the geometry could not be evaluated, and the caller must not carry on
 * as though the check passed — but tagged, so a stack trace names GEOS as the
 * source.
 */
const GEOS_HANDLERS = {
  noticeHandler: (message) => logger.debug(`geos notice: ${message}`),
  errorHandler: (message) => {
    throw new Error(`GEOS error: ${message}`)
  }
}

/**
 * Read a NUL-terminated C string out of wasm memory and free the buffer GEOS
 * allocated for it.
 *
 * @param {object} geos
 * @param {number} pointer
 * @returns {string|null}
 */
function takeString(geos, pointer) {
  if (!pointer) {
    return null
  }
  const value = geos.Module.UTF8ToString(pointer)
  geos.GEOSFree(pointer)
  return value
}

/**
 * Copy an array of geometry pointers into wasm memory so
 * GEOSGeom_createCollection can take ownership of them.
 *
 * @param {object} geos
 * @param {number[]} pointers
 * @returns {number} pointer to the array
 */
function toPointerArray(geos, pointers) {
  const buffer = geos.Module._malloc(pointers.length * POINTER_BYTES)
  for (let i = 0; i < pointers.length; i++) {
    geos.Module.HEAPU32[(buffer >> HEAPU32_SHIFT) + i] = pointers[i]
  }
  return buffer
}

/**
 * Wrap a freshly initialised geos-wasm handle in the small typed surface the
 * checks use.
 *
 * @param {object} geos
 * @returns {GeosRuntime}
 */
function buildRuntime(geos) {
  const doubleOut = geos.Module._malloc(DOUBLE_BYTES)
  const reasonOut = geos.Module._malloc(POINTER_BYTES)
  const locationOut = geos.Module._malloc(POINTER_BYTES)

  // Trim on, rounding precision left at the default: that combination makes
  // GEOS print the shortest representation that round-trips, which is the same
  // thing PostGIS's ST_AsText does, digit for digit. See postgisWkt for the
  // remaining (purely cosmetic) difference.
  const wktWriter = geos.GEOSWKTWriter_create()
  geos.GEOSWKTWriter_setTrim(wktWriter, 1)
  geos.GEOSWKTWriter_setOutputDimension(wktWriter, WKT_OUTPUT_DIMENSION)

  /** GEOSArea and GEOSLength both return their answer through a double*. */
  const readDouble = (call, g) => {
    call(g, doubleOut)
    return geos.Module.HEAPF64[doubleOut >> HEAPF64_SHIFT]
  }

  const free = (g) => {
    if (g) {
      geos.GEOSGeom_destroy(g)
    }
  }

  return {
    geos,
    version: geosVersion(geos),
    fromGeoJson: (geometry) => geojsonToGeosGeom(geometry, geos),
    area: (g) => readDouble(geos.GEOSArea, g),
    length: (g) => readDouble(geos.GEOSLength, g),
    makeValid: (g) => geos.GEOSMakeValid(g),
    isValid: (g) => geos.GEOSisValid(g) === 1,
    validDetail: (g) => readValidDetail(geos, g, reasonOut, locationOut),
    toWkt: (g) =>
      postgisWkt(
        takeString(geos, geos.GEOSWKTWriter_write(wktWriter, g)) ?? ''
      ),
    unionAll: (geoms) => unionAll(geos, geoms, free),
    free
  }
}

/**
 * Rewrite GEOS's WKT into PostGIS's spelling of the same string.
 *
 * WKT reaches the user: `location_wkt` names where an invalid redline breaks,
 * `escape_location_wkt` names where a parcel leaves the boundary, and both are
 * interpolated straight into the error message. The two libraries agree on
 * every digit — GEOS with trim and default precision emits the same
 * shortest-round-trip numbers ST_AsText does — but disagree on two pieces of
 * punctuation: GEOS writes `POLYGON ((1 2, 3 4))` where PostGIS writes
 * `POLYGON((1 2,3 4))`.
 *
 * Left alone, that cosmetic gap would show up as a changed error message the
 * day the engine is switched over, and as noise in every shadow-mode
 * comparison. Neither replacement can touch a coordinate: a space before an
 * open bracket, and a space after a comma, never occur inside a number.
 *
 * @param {string} wkt
 * @returns {string}
 */
function postgisWkt(wkt) {
  return wkt.replaceAll(' (', '(').replaceAll(', ', ',')
}

/**
 * The GEOS version string, e.g. "3.13.0-CAPI-1.19.0".
 *
 * Logged with every divergence so a disagreement between engines can be tied
 * to a specific GEOS build (spike risk R4: WASM 3.13 vs whatever the RDS
 * PostGIS links against). geos-wasm marshals this one to a JS string for us,
 * unlike the other char*-returning entry points.
 *
 * @param {object} geos
 * @returns {string}
 */
function geosVersion(geos) {
  const raw = geos.GEOSversion()
  return typeof raw === 'string' ? raw : (takeString(geos, raw) ?? 'unknown')
}

/**
 * GEOSisValidDetail's reason and location come back through out-parameters and
 * are the caller's to free — the reason as a C string, the location as a
 * geometry. Mirrors PostGIS's `(ST_IsValidDetail(geom)).reason` plus
 * `ST_AsText((ST_IsValidDetail(geom)).location)`.
 *
 * @returns {{ valid: boolean, reason: string|null, location: number|null }}
 */
function readValidDetail(geos, g, reasonOut, locationOut) {
  geos.Module.HEAPU32[reasonOut >> HEAPU32_SHIFT] = 0
  geos.Module.HEAPU32[locationOut >> HEAPU32_SHIFT] = 0

  const valid =
    geos.GEOSisValidDetail(
      g,
      VALID_DETAIL_DEFAULT_FLAGS,
      reasonOut,
      locationOut
    ) === 1

  const reason = takeString(
    geos,
    geos.Module.HEAPU32[reasonOut >> HEAPU32_SHIFT]
  )
  const location = geos.Module.HEAPU32[locationOut >> HEAPU32_SHIFT] || null

  return { valid, reason, location }
}

/**
 * Dissolve a list of geometries into one, the equivalent of PostGIS's
 * `ST_Union(geom)` aggregate: wrap them in a GEOMETRYCOLLECTION and run a unary
 * union over it.
 *
 * The collection takes ownership of the pointers it is given, so callers pass
 * clones and let `GEOSGeom_destroy` on the collection free them.
 *
 * @param {object} geos
 * @param {number[]} geoms geometry pointers the collection may take ownership of
 * @param {(g: number) => void} free
 * @returns {number|null} the dissolved geometry, or null for an empty input
 */
function unionAll(geos, geoms, free) {
  if (geoms.length === 0) {
    return null
  }
  const array = toPointerArray(geos, geoms)
  const collection = geos.GEOSGeom_createCollection(
    GEOS_GEOMETRYCOLLECTION,
    array,
    geoms.length
  )
  const dissolved = geos.GEOSUnaryUnion(collection)
  free(collection)
  geos.Module._free(array)
  return dissolved
}
