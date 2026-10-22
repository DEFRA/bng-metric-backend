import { readGeoPackage } from '../geopackage.js'
import { validateGeoPackageLayers } from '../index.js'
import { EXTRACT_VARIANT } from '../properties.js'
import { FEATURE_READ_MODE } from '../read-feature-tables.js'

/**
 * The Baseline tables of a BNG Service template file uploaded at the baseline
 * + post-intervention endpoint.
 *
 * That endpoint saves the baseline the file holds, not one derived from its
 * post-intervention rows, so the Baseline tables are checked exactly as the
 * baseline endpoint checks them, and their shapes are read for saving with
 * the sizes the check measured. The Post-Intervention tables go through the
 * endpoint's own checks.
 */

/**
 * Check the Baseline tables: the geometry checks in a worker, then the
 * baseline data-quality checks over `loadBaselineLayers()`. Null when the
 * upload has no Baseline tables to check: a legacy file, or the baseline
 * endpoint, which reads them as its own stage.
 *
 * @param {object} upload the route's context for the upload
 * @param {string} upload.filePath
 * @param {import('./template-tables.js').TemplateReadSource} [upload.baselineReadSource]
 * @param {() => object} [upload.loadBaselineLayers] the Baseline tables' attributes
 * @param {string | null} [upload.projectId] measure each feature, to save it
 *   to this project
 * @returns {Promise<{ valid: boolean, errors: Array<object>, sizes?: object } | null>}
 */
export async function validateBaselineStage({
  filePath,
  baselineReadSource,
  loadBaselineLayers,
  projectId
}) {
  if (!baselineReadSource) {
    return null
  }
  return validateGeoPackageLayers(
    loadBaselineLayers,
    EXTRACT_VARIANT.BASELINE,
    {
      filePath,
      includeSizes: Boolean(projectId),
      source: baselineReadSource
    }
  )
}

/**
 * The Baseline tables' shapes, for saving, with the sizes their check
 * measured. Undefined when there is no baseline stage to save.
 *
 * @param {{ filePath: string, baselineReadSource?: import('./template-tables.js').TemplateReadSource }} upload
 * @param {{ sizes?: object } | null} baselineCheck validateBaselineStage's result
 * @returns {{ layers: object, geometrySizes?: object } | undefined}
 */
export function readBaselineStage(
  { filePath, baselineReadSource },
  baselineCheck
) {
  if (!baselineReadSource || !baselineCheck) {
    return undefined
  }
  return {
    layers: readGeoPackage(
      filePath,
      FEATURE_READ_MODE.serialised,
      baselineReadSource
    ),
    geometrySizes: baselineCheck.sizes
  }
}
