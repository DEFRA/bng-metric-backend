import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  waitForUploadReady,
  UploadTimeoutError
} from '../services/cdp-uploader/cdp-uploader.js'
import { downloadFile, S3TimeoutError } from '../services/s3/download-file.js'
import { validateGpkg } from '../services/gpkg/validate-gpkg.js'
import { createLogger } from '../common/helpers/logging/logger.js'

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
 *                     type: string
 *       400:
 *         description: uploadId is missing or not a valid UUID
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

    let bucket, key
    try {
      ;({ bucket, key } = await waitForUploadReady(uploadId))
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

    let buffer
    try {
      buffer = await downloadFile(bucket, key)
    } catch (err) {
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

    const result = validateGpkg(buffer)

    return h.response(result)
  }
}

export { validateBaseline }
