import { checkAdvanceAndDelayNotBothSet } from './advance-delay-check.js'
import { checkHabitatDistinctiveness } from './distinctiveness-check.js'
import { checkDuplicateHabitatRefs } from './duplicate-ref-check.js'
import { readBaselineGeoPackage } from './geopackage.js'
import { validateBaselineLayersPostgis } from './postgis/index.js'

// MERGE NOTE (PR #16): the geometry checks below assume validateGpkg already
// ran and passed — caller must run that format gate first.

/**
 * Run every geometry check against an open baseline GeoPackage file.
 *
 * @param {string} filePath
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ valid: boolean, errors: Array<{ code: string, message: string }> }>}
 */
export async function validateBaselineFile(filePath, pool, variant) {
  const layers = readBaselineGeoPackage(filePath)
  return validateBaselineLayers(layers, pool, variant)
}

/**
 * Same as validateBaselineFile, but takes already-parsed layers.
 *
 * @param {object} layers Output of readBaselineGeoPackage
 * @param {import('pg').Pool} pool
 * @param {string} [variant] one of EXTRACT_VARIANT; selects Baseline* vs
 *   Proposed* columns for the distinctiveness scope check. Defaults to baseline.
 */
export async function validateBaselineLayers(layers, pool, variant) {
  if (!pool) {
    throw new Error('validateBaselineLayers requires a pg pool')
  }
  const { valid, errors } = await validateBaselineLayersPostgis(pool, layers)
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
