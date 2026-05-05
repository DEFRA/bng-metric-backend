import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  waitForUploadReady,
  UploadTimeoutError
} from '../services/cdp-uploader/cdp-uploader.js'
import {
  downloadFile,
  S3FileTooLargeError,
  S3TimeoutError
} from '../services/s3/download-file.js'
import { validateGpkg } from '../services/gpkg/validate-gpkg.js'
import { validateBaselineFile } from '../validation/baseline/index.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

const logger = createLogger()

async function resolveUploadLocation(uploadId) {
  try {
    return await waitForUploadReady(uploadId)
  } catch (err) {
    if (err instanceof UploadTimeoutError) {
      logger.error(
        `validateBaseline: upload did not become ready for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Upload did not complete in time')
    }
    logger.error(
      `validateBaseline: upload failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Upload failed or was rejected')
  }
}

async function fetchBaselineBuffer(bucket, key, uploadId) {
  try {
    return await downloadFile(bucket, key)
  } catch (err) {
    if (err instanceof S3FileTooLargeError) {
      logger.error(
        `validateBaseline: S3 object too large for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.entityTooLarge('File exceeds the maximum allowed size')
    }
    if (err instanceof S3TimeoutError) {
      logger.error(
        `validateBaseline: S3 download timed out for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Timed out downloading file from storage')
    }
    logger.error(
      `validateBaseline: S3 download failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Unable to download file from storage')
  }
}

async function runFullValidation(buffer, pgPool, uploadId, h) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-'))
  const localPath = path.join(tmpDir, 'baseline.gpkg')

  try {
    await fs.writeFile(localPath, buffer)
    const result = await validateBaselineFile(localPath, pgPool)
    if (result.valid) {
      logger.info(`validateBaseline - accepted uploadId ${uploadId}`)
    } else {
      logger.info(
        `validateBaseline - rejected uploadId ${uploadId}: ${result.errors
          .map((e) => `${e.code}: ${e.message}`)
          .join(' | ')}`
      )
    }
    return h.response(result)
  } catch (error) {
    logger.error(
      `validateBaseline - error validating uploadId ${uploadId}: ${error.message}`
    )
    return h
      .response({
        valid: false,
        errors: [
          {
            code: 'VALIDATION_FAILED',
            message: 'Unable to validate baseline file'
          }
        ]
      })
      .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * @openapi
 * /baseline/validate/{uploadId}:
 *   post:
 *     tags:
 *       - Baseline
 *     summary: Validate a baseline GeoPackage upload
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Returns validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code: { type: string }
 *                       message: { type: string }
 *                       offendingFeatures:
 *                         type: array
 *                         items: { type: object }
 *       400:
 *         description: uploadId is missing or not a valid UUID
 *       413:
 *         description: File exceeds the maximum allowed size (100 MB)
 *       502:
 *         description: Upload failed or rejected, or S3 connection error
 *       504:
 *         description: Upload did not reach ready state in time, or S3 download timed out
 */
const validateBaseline = {
  method: 'POST',
  path: '/baseline/validate/{uploadId}',
  options: {
    validate: {
      params: Joi.object({
        uploadId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, h) => {
    const { uploadId } = request.params

    const { bucket, key } = await resolveUploadLocation(uploadId)
    const buffer = await fetchBaselineBuffer(bucket, key, uploadId)

    const gateResult = validateGpkg(buffer)
    if (!gateResult.valid) {
      logger.info(
        `validateBaseline - rejected at gpkg gate uploadId ${uploadId}`
      )
      return h.response(gateResult)
    }

    return runFullValidation(buffer, request.pg, uploadId, h)
  }
}

export { validateBaseline }
