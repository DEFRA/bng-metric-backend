import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  initiateUpload as initiateUploadService,
  getUploadStatus
} from '../services/cdp-uploader/cdp-uploader.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * @openapi
 * /upload/initiate:
 *   post:
 *     tags:
 *       - Upload
 *     summary: Initiate a file upload
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - redirect
 *               - s3Bucket
 *             properties:
 *               redirect:
 *                 type: string
 *               s3Bucket:
 *                 type: string
 *               s3Path:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Returns upload ID and URL
 *       502:
 *         description: Upstream upload service error
 *
 * /upload/{uploadId}/status:
 *   get:
 *     tags:
 *       - Upload
 *     summary: Get upload status
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Returns the upload status
 */
const initiateUpload = {
  method: 'POST',
  path: '/upload/initiate',
  options: {
    validate: {
      payload: Joi.object({
        redirect: Joi.string().uri({ allowRelative: true }).required(),
        s3Bucket: Joi.string().required(),
        s3Path: Joi.string().optional(),
        metadata: Joi.object().optional()
      })
    }
  },
  handler: async (request, _h) => {
    const { redirect, s3Bucket, s3Path } = request.payload

    try {
      logger.info(
        `upload/initiate handler reached - redirect: ${redirect}, s3Bucket: ${s3Bucket}, s3Path: ${s3Path}`
      )
      const result = await initiateUploadService(request.payload)
      logger.info(
        `upload/initiate - result: ${JSON.stringify({ uploadId: result.uploadId, uploadUrl: result.uploadUrl, error: result.error })}`
      )

      if (result.error) {
        throw Boom.badGateway(result.error)
      }

      return result
    } catch (error) {
      if (Boom.isBoom(error)) {
        throw error
      }
      logger.error(
        error,
        `upload/initiate unhandled error - redirect: ${redirect}, s3Bucket: ${s3Bucket}, s3Path: ${s3Path}`
      )
      throw Boom.internal('Failed to initiate upload')
    }
  }
}

const uploadStatus = {
  method: 'GET',
  path: '/upload/{uploadId}/status',
  options: {
    validate: {
      params: Joi.object({
        uploadId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, h) => {
    const result = await getUploadStatus(request.params.uploadId)
    return h.response(result)
  }
}

export { initiateUpload, uploadStatus }
