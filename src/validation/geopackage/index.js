import { checkAdvanceAndDelayNotBothSet } from './advance-delay-check.js'
import { checkHabitatDistinctiveness } from './distinctiveness-check.js'
import { checkDuplicateHabitatRefs } from './duplicate-ref-check.js'
import { readGeoPackage } from './geopackage.js'
import { runGeometryValidation } from './engine.js'

// The geometry checks below assume the format gate already ran and passed —
// the upload route gets both from validateAndReadGpkg in one read.

/**
 * Run every geometry check against an open baseline GeoPackage file.
 *
 * @param {string} filePath
 * @param {import('pg').Pool} pool
 * @param {string} [variant]
 * @returns {Promise<{ valid: boolean, errors: Array<{ code: string, message: string }> }>}
 */
export async function validateBaselineFile(filePath, pool, variant) {
  const layers = readGeoPackage(filePath)
  return validateGeoPackageLayers(layers, pool, variant, { filePath })
}

/**
 * Same as validateBaselineFile, but takes already-parsed layers.
 *
 * `options.filePath` is what lets the geometry work leave the main thread: the
 * GEOS engine hands the path to a worker and lets it do its own parse, rather
 * than structured-cloning a ~17 MB layers object across the thread boundary.
 * Without it the geometry engine falls back to PostGIS — see engine.js.
 *
 * @param {object} layers Output of readGeoPackage
 * @param {import('pg').Pool} pool
 * @param {string} [variant] one of EXTRACT_VARIANT; selects Baseline* vs
 *   Proposed* columns for the distinctiveness scope check. Defaults to baseline.
 * @param {object} [options]
 * @param {string} [options.filePath] the same GeoPackage, on local disk
 * @param {boolean} [options.includeSizes] also return per-feature areas and
 *   lengths when the geometry engine can supply them
 */
export async function validateGeoPackageLayers(
  layers,
  pool,
  variant,
  options = {}
) {
  if (!pool) {
    throw new Error('validateGeoPackageLayers requires a pg pool')
  }
  const { valid, errors, sizes } = await runGeometryValidation({
    layers,
    pool,
    filePath: options.filePath,
    includeSizes: options.includeSizes
  })
  // JS-side checks that don't need PostGIS. Surface ahead of geometry errors so
  // the user sees blocking policy/data-quality issues first.
  const dataQualityErrors = [
    checkHabitatDistinctiveness(layers, variant),
    checkDuplicateHabitatRefs(layers),
    checkAdvanceAndDelayNotBothSet(layers)
  ].filter(Boolean)
  if (dataQualityErrors.length === 0) {
    return { valid, errors, sizes }
  }
  return { valid: false, errors: [...dataQualityErrors, ...errors], sizes }
}
