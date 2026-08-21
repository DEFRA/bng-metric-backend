import { saveUploadForProject } from './save-upload-for-project.js'
import { validateGeoPackageLayers } from '../../validation/geopackage/index.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { metricsCounter } from '../../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_CATEGORY
} from '../../common/helpers/metric-names.js'

const logger = createLogger()

/**
 * Everything after the GeoPackage has been parsed: the geometry and
 * data-quality checks, and the save when a project was named.
 *
 * Shared by both entry points so they cannot drift. The synchronous route
 * parses inline and calls this; the async job parses on a worker thread and
 * calls this with the layers that came back. Only the parse differs — the
 * checks, the metrics and the response shapes are identical either way.
 */

/**
 * The format gate rejected the file before any shape was unpacked.
 */
async function respondToGateRejection(gateResult, uploadId, h, config) {
  logger.info(
    `${config.routeName} - rejected at gpkg gate uploadId ${uploadId}`
  )
  await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
    category: VALIDATION_CATEGORY.internalData
  })
  return h.response({ valid: gateResult.valid, errors: gateResult.errors })
}

/**
 * The shapes parsed, but the geometry or data-quality checks failed.
 */
async function respondToGeometryRejection(result, uploadId, h, config) {
  logger.info(
    `${config.routeName} - rejected uploadId ${uploadId}: ${result.errors
      .map((e) => `${e.code}: ${e.message}`)
      .join(' | ')}`
  )
  await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
    category: VALIDATION_CATEGORY.geometric
  })
  return h.response(result)
}

async function validateLayersAndSave(
  layers,
  drizzle,
  pgPool,
  context,
  h,
  config
) {
  const { uploadId, projectId, credentials, filename, fileSize } = context
  const result = await validateGeoPackageLayers(
    layers,
    pgPool,
    config.projectDocumentKey
  )
  if (!result.valid) {
    return respondToGeometryRejection(result, uploadId, h, config)
  }

  logger.info(`${config.routeName} - accepted uploadId ${uploadId}`)
  await metricsCounter(GEOPACKAGE_METRIC.validationSucceeded)
  if (!projectId) {
    return h.response(result)
  }

  const errorResponse = await saveUploadForProject(
    { drizzle, pgPool, logger },
    projectId,
    layers,
    { uploadId, credentials, filename, fileSize },
    h,
    config
  )
  return errorResponse ?? h.response(result)
}

export {
  respondToGateRejection,
  respondToGeometryRejection,
  validateLayersAndSave
}
