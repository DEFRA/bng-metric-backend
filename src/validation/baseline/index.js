import { checkBaselineDistinctiveness } from './distinctiveness-check.js'
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
export async function validateBaselineFile(filePath, pool) {
  const layers = readBaselineGeoPackage(filePath)
  return validateBaselineLayers(layers, pool)
}

/**
 * Same as validateBaselineFile, but takes already-parsed layers.
 *
 * @param {object} layers Output of readBaselineGeoPackage
 * @param {import('pg').Pool} pool
 */
export async function validateBaselineLayers(layers, pool) {
  if (!pool) {
    throw new Error('validateBaselineLayers requires a pg pool')
  }
  const { valid, errors } = await validateBaselineLayersPostgis(pool, layers)
  // Distinctiveness is a JS-side eligibility check (BMD-352). Surface it ahead
  // of geometry errors so the user sees the policy blocker first.
  const distinctivenessError = checkBaselineDistinctiveness(layers)
  if (!distinctivenessError) {
    return { valid, errors }
  }
  return { valid: false, errors: [distinctivenessError, ...errors] }
}
