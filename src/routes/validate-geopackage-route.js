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
import { saveUploadForProject } from '../services/upload/save-upload-for-project.js'
import { ERROR_CODES, makeError } from '../validation/geopackage/errors.js'
import { habitatDataSchema } from '../validation/project.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { metricsCounter, metricsByteSize } from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_CATEGORY
} from '../common/helpers/metric-names.js'

const logger = createLogger()

async function resolveUploadLocation(uploadId, config) {
  try {
    return await waitForUploadReady(uploadId)
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
    return await downloadFileToTemp(bucket, key)
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
  if (!metaError) {
    return null
  }

  logger.info(
    `${config.routeName} - metadata schema rejected uploadId ${uploadId}: ${metaError.message}`
  )
  return h.response({
    valid: false,
    errors: [makeError(ERROR_CODES.INVALID_FILE_METADATA, metaError.message)]
  })
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

async function validateLayers(layers, drizzle, pgPool, context, h, config) {
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

/**
 * Validate the downloaded file end to end. The GeoPackage is opened once, in
 * place on disk: the format gate rejects a structurally broken file before any
 * shape is unpacked, and an accepted file hands back its parsed layers from
 * the same read.
 */
async function runFullValidation(
  filePath,
  drizzle,
  pgPool,
  context,
  h,
  config
) {
  const { uploadId } = context

  try {
    const gateResult = validateAndReadGpkgFile(filePath)
    if (!gateResult.valid) {
      return await respondToGateRejection(gateResult, uploadId, h, config)
    }
    return await validateLayers(
      gateResult.layers,
      drizzle,
      pgPool,
      context,
      h,
      config
    )
  } catch (error) {
    if (error?.isBoom) {
      throw error
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
      // whole files in memory (BMD-913).
      const upload = await fetchUploadFile(bucket, key, uploadId, config)
      try {
        return await runFullValidation(
          upload.path,
          request.drizzle,
          request.pg,
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
      }
    }
  }
}

export { createValidateGeoPackageRoute }
