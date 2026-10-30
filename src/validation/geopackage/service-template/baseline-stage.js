import {
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION
} from 'bng-library/bng-service'

import { countFeatures } from '../count-features.js'
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
 * endpoint's own checks, and the two stages' verdicts are merged.
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
 * @param {boolean} [upload.includeSizes] measure each feature, to save it
 * @param {boolean} [upload.inThread] check the geometry on this thread, not
 *   in a worker (see validateGeoPackageLayers)
 * @returns {Promise<{ valid: boolean, errors: Array<object>, sizes?: object, poolTelemetry?: object, featureCount: number } | null>}
 *   `featureCount` is the features the Baseline tables hold, for the route's
 *   metrics
 */
export async function validateBaselineStage({
  filePath,
  baselineReadSource,
  loadBaselineLayers,
  includeSizes = false,
  inThread = false
}) {
  if (!baselineReadSource) {
    return null
  }
  let featureCount = 0
  const verdict = await validateGeoPackageLayers(
    () => {
      const layers = loadBaselineLayers()
      featureCount = countFeatures(layers)
      return layers
    },
    EXTRACT_VARIANT.BASELINE,
    {
      filePath,
      includeSizes,
      source: baselineReadSource,
      inThread
    }
  )
  return { ...verdict, featureCount }
}

const withStage = (errors, stage) =>
  errors.map((error) => ({ ...error, stage }))

/**
 * One verdict on an upload from both stages' checks: valid only when both
 * are. Each error names the `stage` whose tables it was found in, as the
 * geometry messages do not name a table. Without a baseline stage, the
 * endpoint's own verdict, unchanged.
 *
 * @param {{ valid: boolean, errors: Array<object> } | null} baselineCheck
 * @param {{ valid: boolean, errors: Array<object> }} result the endpoint's
 *   own checks, of the Post-Intervention tables
 * @returns {{ valid: boolean, errors: Array<object> }}
 */
export function mergeStageVerdicts(baselineCheck, result) {
  if (!baselineCheck) {
    return result
  }
  return {
    valid: baselineCheck.valid && result.valid,
    errors: [
      ...withStage(baselineCheck.errors, STAGE_BASELINE),
      ...withStage(result.errors, STAGE_POST_INTERVENTION)
    ]
  }
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
