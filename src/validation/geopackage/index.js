import { checkAdvanceAndDelayNotBothSet } from './advance-delay-check.js'
import { checkHabitatDistinctiveness } from './distinctiveness-check.js'
import { checkDuplicateHabitatRefs } from './duplicate-ref-check.js'
import { readGeoPackage } from './geopackage.js'
import { validateGeoPackageLayersPostgis } from './postgis/index.js'

// The geometry checks below assume the format gate already ran and passed —
// the upload route gets both from validateAndReadGpkg in one read.

/**
 * Run every geometry check against an open baseline GeoPackage file.
 *
 * @param {string} filePath
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ valid: boolean, errors: Array<{ code: string, message: string }> }>}
 */
export async function validateBaselineFile(filePath, pool, variant) {
  const layers = readGeoPackage(filePath)
  return validateGeoPackageLayers(layers, pool, variant)
}

/**
 * Same as validateBaselineFile, but takes already-parsed layers.
 *
 * @param {object} layers Output of readGeoPackage
 * @param {import('pg').Pool} pool
 * @param {string} [variant] one of EXTRACT_VARIANT; selects Baseline* vs
 *   Proposed* columns for the distinctiveness scope check. Defaults to baseline.
 */
export async function validateGeoPackageLayers(layers, pool, variant) {
  if (!pool) {
    throw new Error('validateGeoPackageLayers requires a pg pool')
  }
  const { valid, errors } = await validateGeoPackageLayersPostgis(pool, layers)
  // JS-side checks that don't need PostGIS. Surface ahead of geometry errors so
  // the user sees blocking policy/data-quality issues first.
  const dataQualityErrors = [
    checkHabitatDistinctiveness(layers, variant),
    checkDuplicateHabitatRefs(layers),
    checkAdvanceAndDelayNotBothSet(layers)
  ].filter(Boolean)
  if (dataQualityErrors.length === 0) {
    return { valid, errors }
  }
  return { valid: false, errors: [...dataQualityErrors, ...errors] }
}
