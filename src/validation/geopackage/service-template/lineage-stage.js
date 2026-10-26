import { readGeoPackage } from '../geopackage.js'
import { FEATURE_READ_MODE } from '../read-feature-tables.js'
import { checkParentLinks } from './lineage/parent-links.js'

/**
 * The lineage check of a BNG Service template file uploaded at the baseline +
 * post-intervention endpoint (BMD-1083): every post-intervention row that
 * names a baseline parent must name one that is in the file, with the shape
 * the row recorded for it.
 *
 * Run in the GEOS worker, on the trip that checks the Post-Intervention
 * tables (geos/worker.js), so it is kept off the request thread and counted
 * in that trip's time: the worker already holds those tables' rows, and reads
 * the Baseline tables, with their geometry, for the shape check.
 *
 * @param {string} filePath
 * @param {object} postInterventionLayers the Post-Intervention tables, read
 * @param {import('./template-tables.js').TemplateReadSource} [lineageSource]
 *   how to read the Baseline tables; absent when there is no baseline stage
 *   to link to (a legacy file, or the baseline endpoint)
 * @returns {Array<object>} the lineage errors; none without a lineageSource
 */
export function lineageErrorsFor(
  filePath,
  postInterventionLayers,
  lineageSource
) {
  if (!lineageSource) {
    return []
  }
  return checkParentLinks(
    readGeoPackage(filePath, FEATURE_READ_MODE.full, lineageSource),
    postInterventionLayers
  )
}

/**
 * A stage's verdict with the lineage errors added after its own: the rows
 * they name are that stage's rows. Unchanged when there are none.
 *
 * @param {{ valid: boolean, errors: Array<object> }} result
 * @param {Array<object>} lineageErrors
 * @returns {{ valid: boolean, errors: Array<object> }}
 */
export function withLineageErrors(result, lineageErrors) {
  if (lineageErrors.length === 0) {
    return result
  }
  return {
    ...result,
    valid: false,
    errors: [...result.errors, ...lineageErrors]
  }
}
