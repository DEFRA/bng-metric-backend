import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Joi from 'joi'

import { getUploadStatus } from '../services/cdp-uploader/cdp-uploader.js'
import { downloadObject } from '../services/s3/s3.js'
import { validateBaselineFile } from '../validation/baseline/index.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

// MERGE NOTE (PR #16): swap getUploadStatus/downloadObject for the PR's
// waitForUploadReady/downloadFile, and run validateGpkg as a gate first.

const logger = createLogger()

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
 *                       ac: { type: string }
 *                       message: { type: string }
 *                       offendingFeatures:
 *                         type: array
 *                         items: { type: object }
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

    const status = await getUploadStatus(uploadId)
    if (status.uploadStatus !== 'ready') {
      logger.warn(
        `validateBaseline - uploadId ${uploadId} is not ready (status: ${status.uploadStatus})`
      )
      return h
        .response({
          valid: false,
          errors: [
            {
              code: 'UPLOAD_NOT_READY',
              message: `Upload is not ready (status: ${status.uploadStatus})`
            }
          ]
        })
        .code(HTTP_STATUS.CONFLICT)
    }

    if (!status.s3Bucket || !status.s3Key) {
      logger.error(
        `validateBaseline - missing S3 location for uploadId ${uploadId}`
      )
      return h
        .response({
          valid: false,
          errors: [
            {
              code: 'UPLOAD_LOCATION_MISSING',
              message: 'Uploaded file location is unknown'
            }
          ]
        })
        .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-'))
    const localPath = path.join(tmpDir, 'baseline.gpkg')

    try {
      await downloadObject({
        bucket: status.s3Bucket,
        key: status.s3Key,
        destination: localPath
      })
      const result = validateBaselineFile(localPath)
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
}

export { validateBaseline }
