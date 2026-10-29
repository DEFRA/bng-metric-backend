/**
 * Import one GeoPackage into a project document exactly as an upload does,
 * without the route: no S3, no CDP Uploader, no worker pool, no database.
 *
 * Built for the metric comparison in bng-metric-harness (BMD-1036), which
 * checks the service's figures against the Statutory Biodiversity Metric's
 * for every scenario in its corpus. It calls this, and nothing else of the
 * pipeline, so the comparison follows any change made here or in the steps
 * it shares with the route:
 *
 * - the format gate (runFormatGate), as the route runs it;
 * - the geometry and data-quality checks (validateGeoPackageLayers, and
 *   validateBaselineStage for a BNG Service template file's Baseline tables),
 *   on this thread rather than in a worker;
 * - building the documents (buildUploadDocuments), which saveUploadForProject
 *   also calls: feature ids, the baseline a post-intervention file replaces
 *   the stored one with, sizing, extraction, enrichment and the schema;
 * - the document the write leaves stored (projectAfterUpload).
 *
 * The order of the first two follows validateLayers in
 * src/routes/validate-geopackage-route.js; keep them in step.
 */

import { readGeoPackage } from '../../validation/geopackage/geopackage.js'
import { runFormatGate } from '../../validation/geopackage/format-gate.js'
import { FEATURE_READ_MODE } from '../../validation/geopackage/read-feature-tables.js'
import { validateGeoPackageLayers } from '../../validation/geopackage/index.js'
import {
  mergeStageVerdicts,
  readBaselineStage,
  validateBaselineStage
} from '../../validation/geopackage/service-template/baseline-stage.js'
import {
  ERROR_CODES,
  makeError,
  makeMetadataError
} from '../../validation/geopackage/errors.js'
import { buildUploadDocuments } from './save-upload-for-project.js'
import { projectAfterUpload } from './persist-upload.js'

/** A logger that says nothing; enrichment only logs engine surprises. */
const SILENT_LOGGER = Object.freeze({
  info() {},
  warn() {},
  error() {},
  debug() {}
})

/**
 * The format gate, then the geometry and data-quality checks, as the
 * validate route runs them, every feature measured for the save.
 *
 * @returns {Promise<{ errors: Array<object>, gate?: object, upload?: object, result?: object, baselineCheck?: object }>}
 */
async function validateUploadFile(filePath, projectDocumentKey) {
  const gate = runFormatGate(filePath, projectDocumentKey)
  if (!gate.valid) {
    return { errors: gate.errors }
  }
  const upload = {
    filePath,
    baselineReadSource: gate.baselineReadSource,
    loadBaselineLayers: () =>
      readGeoPackage(
        filePath,
        FEATURE_READ_MODE.properties,
        gate.baselineReadSource
      ),
    // Any project: the import always saves, so every feature is measured.
    projectId: 'import',
    inThread: true
  }
  const baselineCheck = await validateBaselineStage(upload)
  const result = await validateGeoPackageLayers(
    () =>
      readGeoPackage(filePath, FEATURE_READ_MODE.properties, gate.readSource),
    projectDocumentKey,
    {
      filePath,
      includeSizes: true,
      source: gate.readSource,
      lineageSource: gate.baselineReadSource,
      inThread: true
    }
  )
  const verdict = mergeStageVerdicts(baselineCheck, result)
  return { errors: verdict.errors, gate, upload, result, baselineCheck }
}

/** The errors an upload whose documents could not be built answers with. */
function refusalErrors(extracted) {
  if (extracted.sizingError) {
    return [
      makeError(ERROR_CODES.SIZING_FAILED, 'Unable to calculate habitat sizes')
    ]
  }
  if (extracted.schemaError) {
    return [makeMetadataError(extracted.schemaError)]
  }
  if (extracted.validationError) {
    return [extracted.validationError]
  }
  return null
}

/**
 * @param {string} filePath the GeoPackage, on local disk
 * @param {object|undefined} storedProject the project document as stored
 *   before this upload: `{}` for a new project
 * @param {{ projectDocumentKey: string, logger?: object }} options
 *   `projectDocumentKey` is the route's: 'baseline' for the baseline upload,
 *   'postIntervention' for the baseline + post-intervention one
 * @returns {Promise<{ accepted: true, project: object } | { accepted: false, errors: Array<{ code: string, message: string }> }>}
 *   `project` is the project document the upload leaves stored, which
 *   toProjectResponse turns into the body `GET /projects/{id}` returns
 */
export async function importUploadFile(
  filePath,
  storedProject,
  { projectDocumentKey, logger = SILENT_LOGGER }
) {
  const validation = await validateUploadFile(filePath, projectDocumentKey)
  if (validation.errors.length > 0) {
    return { accepted: false, errors: validation.errors }
  }
  const { gate, upload, result, baselineCheck } = validation

  // The accepted file is re-read in `serialised` mode for the save, as the
  // route reads it.
  const config = { projectDocumentKey }
  const extracted = await buildUploadDocuments(
    readGeoPackage(filePath, FEATURE_READ_MODE.serialised, gate.readSource),
    storedProject,
    {
      uploadId: null,
      filename: null,
      fileSize: null,
      geometrySizes: result.sizes,
      template: gate.template,
      baselineStage: readBaselineStage(upload, baselineCheck)
    },
    { logger, config }
  )
  const errors = refusalErrors(extracted)
  if (errors) {
    return { accepted: false, errors }
  }
  return {
    accepted: true,
    project: projectAfterUpload(storedProject, extracted, projectDocumentKey)
  }
}
