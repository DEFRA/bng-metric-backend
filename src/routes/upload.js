import Joi from 'joi'

import {
  initiateUpload as initiateUploadService,
  getUploadStatus
} from '../services/cdp-uploader/cdp-uploader.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

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
  handler: async (request, h) => {
    logger.info(
      `upload/initiate - received redirect: ${request.payload.redirect}`
    )
    const result = await initiateUploadService(request.payload)
    logger.info(
      `upload/initiate - result: ${JSON.stringify({ uploadId: result.uploadId, uploadUrl: result.uploadUrl, error: result.error })}`
    )

    if (result.error) {
      return h.response({ error: result.error }).code(500)
    }

    return h.response(result)
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
