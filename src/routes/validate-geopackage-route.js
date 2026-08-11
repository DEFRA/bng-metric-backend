import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
import {
  validateGpkg,
  readGeoPackage
} from '../validation/geopackage/geopackage.js'
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

/** Prefix for ephemeral GeoPackage staging directories under os.tmpdir(). */
const UPLOAD_TEMP_PREFIX = 'baseline-'

/** Fixed filename inside the staging directory (not derived from user input). */
const UPLOAD_TEMP_FILENAME = 'baseline.gpkg'

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

async function runFullValidation(buffer, drizzle, pgPool, context, h, config) {
  const { uploadId, projectId, credentials, filename, fileSize } = context
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), UPLOAD_TEMP_PREFIX))
  const localPath = path.join(tmpDir, UPLOAD_TEMP_FILENAME)

  try {
    await fs.writeFile(localPath, buffer)
    const layers = readGeoPackage(localPath)
    const result = await validateGeoPackageLayers(
      layers,
      pgPool,
      config.projectDocumentKey
    )
    if (!result.valid) {
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
    logger.info(`${config.routeName} - accepted uploadId ${uploadId}`)
    await metricsCounter(GEOPACKAGE_METRIC.validationSucceeded)
    if (projectId) {
      const errorResponse = await saveUploadForProject(
        { drizzle, pgPool, logger },
        projectId,
        layers,
        { uploadId, credentials, filename, fileSize },
        h,
        config
      )
      if (errorResponse) {
        return errorResponse
      }
      return h.response(result)
    }
    return h.response(result)
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
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
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

      const gateResult = validateGpkg(buffer)
      if (!gateResult.valid) {
        logger.info(
          `${config.routeName} - rejected at gpkg gate uploadId ${uploadId}`
        )
        await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
          category: VALIDATION_CATEGORY.internalData
        })
        return h.response(gateResult)
      }

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
