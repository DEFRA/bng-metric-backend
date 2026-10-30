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
 * - the geometry and data-quality checks and the read for the save
 *   (checkUploadLayers, readUploadForSave), which the route calls too, here
 *   with the geometry checked on this thread rather than in a worker;
 * - building the documents (buildUploadDocuments), which saveUploadForProject
 *   also calls: feature ids, the baseline a post-intervention file replaces
 *   the stored one with, sizing, extraction, enrichment and the schema;
 * - the document the write leaves stored (projectAfterUpload).
 */

import { readGeoPackage } from '../../validation/geopackage/geopackage.js'
import { runFormatGate } from '../../validation/geopackage/format-gate.js'
import { FEATURE_READ_MODE } from '../../validation/geopackage/read-feature-tables.js'
import {
  checkUploadLayers,
  readUploadForSave
} from '../../validation/geopackage/upload-checks.js'
import {
  buildUploadDocuments,
  uploadRefusal
} from './save-upload-for-project.js'
import { projectAfterUpload } from './persist-upload.js'

/** A logger that says nothing; enrichment only logs engine surprises. */
const SILENT_LOGGER = Object.freeze({
  info() {},
  warn() {},
  error() {},
  debug() {}
})

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
  const gate = runFormatGate(filePath, projectDocumentKey)
  if (!gate.valid) {
    return { accepted: false, errors: gate.errors }
  }
  const attributes = (source) => () =>
    readGeoPackage(filePath, FEATURE_READ_MODE.properties, source)
  const upload = {
    filePath,
    loadLayers: attributes(gate.readSource),
    readSource: gate.readSource,
    baselineReadSource: gate.baselineReadSource,
    loadBaselineLayers: attributes(gate.baselineReadSource),
    // An import always saves, so every feature is measured.
    includeSizes: true,
    inThread: true
  }
  const checks = await checkUploadLayers(upload, projectDocumentKey)
  if (!checks.verdict.valid) {
    return { accepted: false, errors: checks.verdict.errors }
  }

  const saved = readUploadForSave(upload, checks)
  const extracted = await buildUploadDocuments(
    saved.layers,
    storedProject,
    {
      uploadId: null,
      filename: null,
      fileSize: null,
      geometrySizes: saved.geometrySizes,
      template: gate.template,
      baselineStage: saved.baselineStage
    },
    { logger, config: { projectDocumentKey } }
  )
  const refusal = uploadRefusal(extracted)
  if (refusal) {
    return { accepted: false, errors: refusal.errors }
  }
  return {
    accepted: true,
    project: projectAfterUpload(storedProject, extracted, projectDocumentKey)
  }
}
