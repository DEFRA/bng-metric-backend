import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  initiateUpload as initiateUploadService,
  getUploadStatus
} from '../services/cdp-uploader/cdp-uploader.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { metricsCounter } from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_CATEGORY
} from '../common/helpers/metric-names.js'

const logger = createLogger()

// CDP Uploader reports a virus rejection via the file's errorMessage (e.g.
// "The selected file contains a virus"). This status route is the single backend
// chokepoint that observes a rejected upload: the frontend polls it and, on a
// rejection, redirects away without calling /baseline/validate, so the validate
// route never sees the virus. Emit the metric here, where the rejection lands.
const VIRUS_REJECTION_PATTERN = /virus/i

/**
 * Emit the virus rejection metric when CDP Uploader has rejected the file for a
 * virus (numberOfRejectedFiles > 0 with a virus errorMessage). No-op otherwise —
 * clean uploads and non-virus rejections are not counted here. The frontend
 * clears the upload session on a rejection, so a given upload's rejected status
 * is polled exactly once, keeping this a once-per-upload emit.
 * @param {{numberOfRejectedFiles?: number, errorMessage?: string|null}} result
 */
async function recordVirusRejectionMetric(result) {
  if (
    result.numberOfRejectedFiles > 0 &&
    VIRUS_REJECTION_PATTERN.test(result.errorMessage ?? '')
  ) {
    await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
      category: VALIDATION_CATEGORY.virus
    })
  }
}

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
    await recordVirusRejectionMetric(result)
    return h.response(result)
  }
}

export { initiateUpload, uploadStatus }
