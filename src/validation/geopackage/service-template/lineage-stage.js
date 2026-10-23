import { readGeoPackage } from '../geopackage.js'
import { FEATURE_READ_MODE } from '../read-feature-tables.js'
import { checkParentLinks } from './lineage/parent-links.js'

/**
 * The lineage check of a BNG Service template file uploaded at the baseline +
 * post-intervention endpoint (BMD-1083): every post-intervention row that
 * names a baseline parent must name one that is in the file, with the shape
 * the row recorded for it. Null when the upload has no baseline stage to link
 * to: a legacy file, or the baseline endpoint.
 *
 * Pure JavaScript, on the request thread: the Baseline tables are read with
 * their geometry, which the shape check needs, and the Post-Intervention
 * tables for their attributes. Run whatever the stage checks found, so the
 * user sees every error at once.
 *
 * @param {object} upload the route's context for the upload
 * @param {string} upload.filePath
 * @param {import('./template-tables.js').TemplateReadSource} [upload.readSource]
 * @param {import('./template-tables.js').TemplateReadSource} [upload.baselineReadSource]
 * @returns {{ valid: boolean, errors: Array<object> } | null}
 */
export function validateLineageStage({
  filePath,
  readSource,
  baselineReadSource
}) {
  if (!baselineReadSource) {
    return null
  }
  const errors = checkParentLinks(
    readGeoPackage(filePath, FEATURE_READ_MODE.full, baselineReadSource),
    readGeoPackage(filePath, FEATURE_READ_MODE.properties, readSource)
  )
  return { valid: errors.length === 0, errors }
}

/**
 * The post-intervention stage's verdict with the lineage check's errors
 * added: the rows it found wrong are post-intervention rows. Unchanged
 * without a lineage check.
 *
 * @param {{ valid: boolean, errors: Array<object> }} result the endpoint's
 *   own checks, of the Post-Intervention tables
 * @param {{ valid: boolean, errors: Array<object> } | null} lineageCheck
 * @returns {{ valid: boolean, errors: Array<object> }}
 */
export function withLineageVerdict(result, lineageCheck) {
  if (!lineageCheck) {
    return result
  }
  return {
    ...result,
    valid: result.valid && lineageCheck.valid,
    errors: [...result.errors, ...lineageCheck.errors]
  }
}
