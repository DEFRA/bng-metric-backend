import Wreck from '@hapi/wreck'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Get the CDP Uploader base URL
 * @returns {string}
 */
export function getCdpUploaderUrl() {
  const explicitUrl = config.get('cdpUploader.url')
  if (explicitUrl) {
    return explicitUrl
  }

  const environment = process.env.ENVIRONMENT
  if (environment && environment !== 'local') {
    return `https://cdp-uploader.${environment}.cdp-int.defra.cloud`
  }

  // Local development fallback
  return 'http://localhost:7337'
}

/**
 * Initiate an upload session with CDP Uploader
 * @param {object} options - Upload options
 * @param {string} options.redirect - URL to redirect to after upload
 * @param {string} options.s3Bucket - Destination S3 bucket
 * @param {string} [options.s3Path] - Optional path within the bucket
 * @param {object} [options.metadata] - Optional metadata
 * @returns {Promise<{uploadId: string, uploadUrl: string} | {error: string}>}
 */
export async function initiateUpload({ redirect, s3Bucket, s3Path, metadata }) {
  const baseUrl = getCdpUploaderUrl()
  const url = `${baseUrl}/initiate`

  logger.info(
    `Initiating upload - url: ${url}, redirect: ${redirect}, s3Bucket: ${s3Bucket}, s3Path: ${s3Path}`
  )

  try {
    const { payload } = await Wreck.post(url, {
      payload: JSON.stringify({
        redirect,
        s3Bucket,
        s3Path,
        metadata
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      json: true
    })

    // Extract just the path from uploadUrl (cdp-uploader may return full URL)
    const uploadUrl = payload.uploadUrl.startsWith('http')
      ? new URL(payload.uploadUrl).pathname
      : payload.uploadUrl

    logger.info(
      `Upload initiated - uploadId: ${payload.uploadId}, raw uploadUrl: ${payload.uploadUrl}, resolved uploadUrl: ${uploadUrl}`
    )
    return {
      uploadId: payload.uploadId,
      uploadUrl
    }
  } catch (error) {
    const statusCode = error?.output?.statusCode
    const responsePayload = error?.data?.payload
    logger.error(
      `Error initiating upload - url: ${url}, baseUrl: ${baseUrl}, s3Bucket: ${s3Bucket}, s3Path: ${s3Path}, statusCode: ${statusCode}, responsePayload: ${JSON.stringify(responsePayload)}, message: ${error?.message}`
    )
    return {
      error: 'Unable to initiate upload'
    }
  }
}

/**
 * Get the upload status from CDP Uploader
 * @param {string} uploadId - The upload ID to check status for
 * @returns {Promise<{uploadStatus: string, error?: string}>}
 */
export async function getUploadStatus(uploadId) {
  const baseUrl = getCdpUploaderUrl()
  const url = `${baseUrl}/status/${uploadId}`

  logger.info(`Fetching upload status - url: ${url}, uploadId: ${uploadId}`)

  try {
    const { payload } = await Wreck.get(url, { json: true })

    const files = payload.files ?? []
    const rejectedFile = files.find((f) => f.fileStatus === 'rejected')

    return {
      uploadStatus: payload.uploadStatus ?? 'unknown',
      numberOfRejectedFiles: payload.numberOfRejectedFiles ?? 0,
      errorMessage: rejectedFile?.errorMessage ?? null
    }
  } catch (error) {
    const statusCode = error?.output?.statusCode
    const responsePayload = error?.data?.payload
    logger.error(
      `Error fetching upload status - url: ${url}, baseUrl: ${baseUrl}, uploadId: ${uploadId}, statusCode: ${statusCode}, responsePayload: ${JSON.stringify(responsePayload)}, message: ${error?.message}`
    )
    return {
      uploadStatus: 'error',
      error: 'Unable to check upload status'
    }
  }
}
