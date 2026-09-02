import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  waitForUploadReady,
  UploadFailedError,
  UploadTimeoutError
} from '../services/cdp-uploader/cdp-uploader.js'
import {
  downloadFileToTemp,
  S3FileTooLargeError,
  S3TimeoutError
} from '../services/s3/download-file.js'
import { validateAndReadGpkgFile } from '../validation/geopackage/geopackage.js'
import { validateGeoPackageLayers } from '../validation/geopackage/index.js'
import {
  getGeosWorkerPool,
  ValidationQueueFullError,
  ValidationQueueWaitError
} from '../validation/geopackage/geos/worker-pool.js'
import { saveUploadForProject } from '../services/upload/save-upload-for-project.js'
import {
  ERROR_CODES,
  makeError,
  makeMetadataError
} from '../validation/geopackage/errors.js'
import { habitatDataSchema } from '../validation/project.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import {
  metricsCounter,
  metricsByteSize,
  metricsMillis,
  metricsGauge
} from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  PERFORMANCE_METRIC,
  VALIDATION_CATEGORY
} from '../common/helpers/metric-names.js'
import { logPerf, perfNow, msSince } from '../common/helpers/perf-evidence.js'
// Aliased: every function in this file takes a route `config` object, and the
// application config is a different thing entirely.
import { config as appConfig } from '../config.js'

const logger = createLogger()

/** Layer keys in a parsed GeoPackage that are not arrays of features. */
const NON_FEATURE_LAYER_KEYS = new Set(['missingLayers'])

/**
 * Total features parsed out of a GeoPackage, across every layer. This is the
 * scale figure that makes every duration below interpretable — a 4 s validate
 * means nothing without knowing whether it covered 40 parcels or 40,000.
 *
 * @param {object} layers
 * @returns {number}
 */
function countFeatures(layers) {
  let total = 0
  for (const [key, value] of Object.entries(layers ?? {})) {
    if (!NON_FEATURE_LAYER_KEYS.has(key) && Array.isArray(value)) {
      total += value.length
    }
  }
  return total
}

/**
 * Record one pipeline stage twice over, because the two destinations answer
 * different questions and neither substitutes for the other:
 *
 *   - a `pipeline-inline` evidence LINE, carrying the high-cardinality detail
 *     (uploadId, feature counts) that you need when investigating one slow
 *     upload in the logs;
 *   - an EMF duration METRIC, carrying only a two-valued `documentKey`
 *     dimension, which is what CloudWatch aggregates and Grafana charts.
 *
 * Both come off the same measurement, so a dashboard and a log line can never
 * disagree about how long a stage took.
 *
 * @param {string} metricName one of PERFORMANCE_METRIC
 * @param {number} durationMs
 * @param {object} fields evidence-line fields (must include `stage`)
 * @param {object} config route config carrying projectDocumentKey
 */
async function recordStage(metricName, durationMs, fields, config) {
  logPerf(logger, 'pipeline-inline', { ...fields, elapsedMs: durationMs })
  await metricsMillis(metricName, durationMs, {
    documentKey: config.projectDocumentKey
  })
}

async function resolveUploadLocation(uploadId, config) {
  try {
    return await waitForUploadReady(uploadId, {
      timeoutMs: appConfig.get('upload.readyTimeoutMs')
    })
  } catch (err) {
    if (err instanceof UploadTimeoutError) {
      logger.error(
        `${config.routeName}: upload did not become ready for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Upload did not complete in time')
    }
    if (err instanceof UploadFailedError) {
      // A rejected upload (virus, wrong type, …) returns 422. The virus *metric*
      // is emitted from the /upload/{uploadId}/status route — the chokepoint the
      // frontend actually polls — not here: the frontend never calls validate for
      // a rejected upload, so this branch is unreachable in the real flow.
      logger.error(
        `${config.routeName}: upload was rejected for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.badData('Upload was rejected')
    }
    logger.error(
      `${config.routeName}: upload failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Unable to verify upload status')
  }
}

/**
 * Stream the upload out of S3 onto local disk. The caller owns the returned
 * file and must `cleanup()` it — see {@link downloadFileToTemp}.
 *
 * @returns {Promise<{ path: string, size: number, cleanup: () => Promise<void> }>}
 */
async function fetchUploadFile(bucket, key, uploadId, config) {
  try {
    return await downloadFileToTemp(bucket, key, {
      timeoutMs: appConfig.get('upload.downloadTimeoutMs')
    })
  } catch (err) {
    if (err instanceof S3FileTooLargeError) {
      logger.error(
        `${config.routeName}: S3 object too large for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.entityTooLarge('File exceeds the maximum allowed size')
    }
    if (err instanceof S3TimeoutError) {
      logger.error(
        `${config.routeName}: S3 download timed out for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Timed out downloading file from storage')
    }
    logger.error(
      `${config.routeName}: S3 download failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Unable to download file from storage')
  }
}

function validateUploadMetadata(uploadId, filename, fileSize, h, config) {
  const { error: metaError } = habitatDataSchema.validate(
    { uploadId, filename, fileSize },
    { allowUnknown: true }
  )
  if (metaError) {
    logger.info(
      `${config.routeName} - metadata schema rejected uploadId ${uploadId}: ${metaError.message}`
    )
    return h.response({
      valid: false,
      errors: [makeMetadataError(metaError)]
    })
  }

  return null
}

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
 * Every validation worker was busy and the queue was full, so the file was
 * never looked at.
 *
 * This is the one rejection that is NOT about the user's file, and it is
 * answered differently on purpose. A 503 with Retry-After says "come back",
 * which is both true and actionable; returning the usual 200-with-errors would
 * put a capacity problem on the same screen as "your polygons overlap" and
 * invite the user to go and edit a file that is perfectly fine.
 */
function validationPool() {
  return getGeosWorkerPool({
    size: appConfig.get('validation.workerCount'),
    queueLimit: appConfig.get('validation.workerQueueLimit'),
    timeoutMs: appConfig.get('validation.workerTimeoutMs'),
    queueWaitLimitMs: appConfig.get('validation.queueWaitLimitMs')
  })
}

/** Both ways the pool can refuse a file without looking at it. */
function isBusyError(error) {
  return (
    error instanceof ValidationQueueFullError ||
    error instanceof ValidationQueueWaitError
  )
}

async function respondToBusy(uploadId, h, config) {
  logger.warn(
    `${config.routeName} - validation queue full for uploadId ${uploadId}; asked the caller to retry`
  )
  await metricsCounter(GEOPACKAGE_METRIC.validationBusy)
  return h
    .response({
      valid: false,
      errors: [
        makeError(
          ERROR_CODES.VALIDATION_BUSY,
          'The service is busy checking other files. Please try again in a few moments.'
        )
      ]
    })
    .code(HTTP_STATUS.SERVICE_UNAVAILABLE)
    .header(
      'Retry-After',
      String(appConfig.get('validation.busyRetryAfterSeconds'))
    )
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

async function validateLayers(layers, drizzle, context, h, config) {
  const { uploadId, projectId, credentials, filename, fileSize, filePath } =
    context

  // Evidence (Item 1 — the whole pipeline runs inline on the request handler):
  // with the PostGIS engine this is a single awaited round trip whose cost
  // scales with the feature count, and it holds the handler for its full
  // duration. With the GEOS engine the work goes to a worker thread and the
  // handler only awaits the verdict — `filePath` is what makes that possible,
  // because the worker parses the file itself rather than being sent a clone
  // of the layers. Sizes are only worth asking for when there is a project to
  // persist them against.
  const validateStart = perfNow()
  const result = await validateGeoPackageLayers(
    layers,
    config.projectDocumentKey,
    { filePath, includeSizes: Boolean(projectId) }
  )
  await recordStage(
    PERFORMANCE_METRIC.geometryValidateMs,
    msSince(validateStart),
    {
      uploadId,
      stage: 'geometry-validate',
      featureCount: countFeatures(layers)
    },
    config
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
    { drizzle, logger },
    projectId,
    layers,
    { uploadId, credentials, filename, fileSize, geometrySizes: result.sizes },
    h,
    config
  )
  return errorResponse ?? h.response(result)
}

/**
 * Validate the downloaded file end to end. The GeoPackage is opened once, in
 * place on disk: the format gate rejects a structurally broken file before any
 * shape is unpacked, and an accepted file hands back its parsed layers from
 * the same read.
 */
async function runFullValidation(filePath, drizzle, context, h, config) {
  const { uploadId } = context

  try {
    // Evidence (Item 2 — features and geometries are loaded synchronously):
    // better-sqlite3 is a synchronous binding, so this call blocks the event
    // loop for its whole duration; nothing else on this instance progresses.
    // Reading from disk rather than a Buffer does not change that.
    const parseStart = perfNow()
    const gateResult = validateAndReadGpkgFile(filePath)
    const parseMs = msSince(parseStart)
    const featureCount = countFeatures(gateResult.layers)

    await recordStage(
      PERFORMANCE_METRIC.parseMs,
      parseMs,
      {
        uploadId,
        stage: 'parse',
        fileSizeBytes: context.fileSize ?? null,
        featureCount,
        valid: gateResult.valid
      },
      config
    )
    await metricsGauge(PERFORMANCE_METRIC.featureCount, featureCount, {
      documentKey: config.projectDocumentKey
    })

    if (!gateResult.valid) {
      return await respondToGateRejection(gateResult, uploadId, h, config)
    }
    return await validateLayers(
      gateResult.layers,
      drizzle,
      { ...context, filePath },
      h,
      config
    )
  } catch (error) {
    if (error?.isBoom) {
      throw error
    }
    // A full queue means the file was never looked at — a capacity condition,
    // not a fault, and the only one of these worth telling the user to retry.
    if (isBusyError(error)) {
      return await respondToBusy(uploadId, h, config)
    }
    logger.error(
      `${config.routeName} - error validating uploadId ${uploadId}: ${error.message}`
    )
    return h
      .response({
        valid: false,
        errors: [
          makeError(
            ERROR_CODES.VALIDATION_FAILED,
            config.validationFailedMessage
          )
        ]
      })
      .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

/**
 * Shared Hapi route factory for baseline and post-intervention GeoPackage
 * validate endpoints. Callers supply a frozen config with path, document key,
 * and user-facing labels.
 *
 * @param {{
 *   routeName: string,
 *   path: string,
 *   projectDocumentKey: 'baseline' | 'postIntervention',
 *   uploadLabel: string,
 *   validationFailedMessage: string
 * }} config
 */
function createValidateGeoPackageRoute(config) {
  return {
    method: 'POST',
    path: config.path,
    options: {
      validate: {
        params: Joi.object({
          uploadId: Joi.string().uuid().required()
        }),
        payload: Joi.object({
          projectId: Joi.string().uuid()
        })
          .allow(null)
          .optional()
      }
    },
    handler: async (request, h) => {
      const { uploadId } = request.params
      const projectId = request.payload?.projectId ?? null
      // Persisting to a project is scoped to this user's current org context.
      const credentials = request.auth.credentials

      // Refuse BEFORE doing any work. The pool would refuse this file anyway,
      // and finding that out after streaming up to 100 MB out of S3 and parsing
      // it would make a refusal expensive — which matters, because the client's
      // answer to a refusal is to try again in a few seconds. Advisory only:
      // the pool re-checks, and can still refuse later.
      if (!validationPool().hasCapacity()) {
        return respondToBusy(uploadId, h, config)
      }

      const { bucket, key, filename, fileSize } = await resolveUploadLocation(
        uploadId,
        config
      )
      if (fileSize != null) {
        await metricsByteSize(GEOPACKAGE_METRIC.uploadSizeBytes, fileSize)
      }
      if (projectId) {
        const metadataErrorResponse = validateUploadMetadata(
          uploadId,
          filename,
          fileSize,
          h,
          config
        )
        if (metadataErrorResponse) {
          return metadataErrorResponse
        }
      }

      // Streamed to disk rather than buffered, and removed as soon as
      // validation is done with it, so concurrent uploads cannot stack up
      // whole files in memory.
      const upload = await fetchUploadFile(bucket, key, uploadId, config)

      const totalStart = perfNow()
      try {
        return await runFullValidation(
          upload.path,
          request.drizzle,
          { uploadId, projectId, credentials, filename, fileSize },
          h,
          config
        )
      } finally {
        // A file we could not delete is a disk problem to chase in the logs,
        // not a reason to fail a validation that already succeeded.
        await upload.cleanup().catch((err) => {
          logger.warn(
            `${config.routeName}: failed to remove the downloaded file for uploadId ${uploadId}: ${err.message}`
          )
        })
        // Evidence (Item 1): the end-to-end handler time a user waits on, with
        // every stage above still running on this one request. Recorded in the
        // `finally` so a failed upload — often the slowest kind — is measured
        // too, matching how each stage above records before checking for
        // errors.
        await recordStage(
          PERFORMANCE_METRIC.totalMs,
          msSince(totalStart),
          { uploadId, stage: 'total', fileSizeBytes: fileSize ?? null },
          config
        )
      }
    }
  }
}

export { createValidateGeoPackageRoute }
