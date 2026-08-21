import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  waitForUploadReady,
  UploadFailedError,
  UploadTimeoutError
} from '../services/cdp-uploader/cdp-uploader.js'
import {
  downloadFile,
  S3FileTooLargeError,
  S3TimeoutError
} from '../services/s3/download-file.js'
import { validateAndReadGpkg } from '../validation/geopackage/geopackage.js'
import {
  respondToGateRejection,
  validateLayersAndSave
} from '../services/upload/validate-layers-and-save.js'
import { ERROR_CODES, makeError } from '../validation/geopackage/errors.js'
import { habitatDataSchema } from '../validation/project.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { metricsByteSize } from '../common/helpers/metrics.js'
import { GEOPACKAGE_METRIC } from '../common/helpers/metric-names.js'

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

async function fetchUploadBuffer(bucket, key, uploadId, config) {
  try {
    return await downloadFile(bucket, key)
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
 * Validate the uploaded buffer end to end. The GeoPackage is opened once: the
 * format gate rejects a structurally broken file before any shape is unpacked,
 * and an accepted file hands back its parsed layers from the same read.
 */
async function runFullValidation(buffer, drizzle, pgPool, context, h, config) {
  const { uploadId } = context

  try {
    const gateResult = validateAndReadGpkg(buffer)
    if (!gateResult.valid) {
      return await respondToGateRejection(gateResult, uploadId, h, config)
    }
    return await validateLayersAndSave(
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

      const buffer = await fetchUploadBuffer(bucket, key, uploadId, config)

      return runFullValidation(
        buffer,
        request.drizzle,
        request.pg,
        { uploadId, projectId, credentials, filename, fileSize },
        h,
        config
      )
    }
  }
}

export { createValidateGeoPackageRoute }
