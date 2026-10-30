/**
 * The checks an upload makes once its file has passed the format gate, and
 * the read of an accepted file for its save: one sequence, called by the
 * validate route (validateLayers) and by importUploadFile, which the metric
 * comparison in bng-metric-harness calls, so the two cannot drift apart.
 *
 * Whatever the route does around them, its metrics, its parse budget and
 * when it drops the attributes, it does through the loaders it passes in and
 * with the results these hand back.
 */

import { readGeoPackage } from './geopackage.js'
import { validateGeoPackageLayers } from './index.js'
import { FEATURE_READ_MODE } from './read-feature-tables.js'
import {
  mergeStageVerdicts,
  readBaselineStage,
  validateBaselineStage
} from './service-template/baseline-stage.js'

/**
 * @typedef {object} UploadToCheck
 * @property {string} filePath the GeoPackage, on local disk
 * @property {() => object} loadLayers the attributes of the stage the upload
 *   is read in, called once a worker is free
 * @property {import('./service-template/template-tables.js').TemplateReadSource} [readSource]
 *   how a BNG Service template file is read; omitted for a legacy one
 * @property {import('./service-template/template-tables.js').TemplateReadSource} [baselineReadSource]
 *   a template file's Baseline tables, which the baseline + post-intervention
 *   endpoint checks and saves too; omitted otherwise
 * @property {() => object} [loadBaselineLayers] the Baseline tables' attributes
 * @property {boolean} [includeSizes] measure every feature, to save it
 * @property {boolean} [inThread] check the geometry on this thread, not in a
 *   worker; never the route (see validateGeoPackageLayers)
 */

/**
 * The geometry and data-quality checks: a template file's Baseline tables
 * first, when the upload has them, then the stage it is read in. Both run
 * whatever either finds, so the user sees every error at once, and their
 * verdicts are merged.
 *
 * @param {UploadToCheck} upload
 * @param {string} projectDocumentKey the route's project document key
 * @returns {Promise<{ verdict: { valid: boolean, errors: Array<object> }, result: object, baselineCheck: object | null }>}
 *   `result` is the stage's own verdict, with its sizes and pool telemetry;
 *   `baselineCheck` the Baseline tables', or null
 */
export async function checkUploadLayers(upload, projectDocumentKey) {
  const baselineCheck = await validateBaselineStage(upload)
  // A template file read at both stages has its parent links checked on the
  // Post-Intervention trip too (BMD-1083): `lineageSource` names the Baseline
  // tables they link to.
  const result = await validateGeoPackageLayers(
    upload.loadLayers,
    projectDocumentKey,
    {
      filePath: upload.filePath,
      includeSizes: Boolean(upload.includeSizes),
      source: upload.readSource,
      lineageSource: upload.baselineReadSource,
      inThread: Boolean(upload.inThread)
    }
  )
  return {
    verdict: mergeStageVerdicts(baselineCheck, result),
    result,
    baselineCheck
  }
}

/**
 * An accepted upload's shapes, read for its save, with the sizes its checks
 * measured.
 *
 * `serialised`, not `full`: the inserts bind geometry as JSON text into
 * ST_GeomFromGeoJSON and never read a coordinate, so the decoded object graph
 * would be built, held across the whole transaction, and never used.
 *
 * @param {UploadToCheck} upload
 * @param {{ result: object, baselineCheck: object | null }} checks checkUploadLayers' result
 * @returns {{ layers: object, geometrySizes?: object, baselineStage?: { layers: object, geometrySizes?: object } }}
 */
export function readUploadForSave(upload, { result, baselineCheck }) {
  return {
    layers: readGeoPackage(
      upload.filePath,
      FEATURE_READ_MODE.serialised,
      upload.readSource
    ),
    geometrySizes: result.sizes,
    baselineStage: readBaselineStage(upload, baselineCheck)
  }
}
