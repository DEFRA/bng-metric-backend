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
    logger.info(
      `getCdpUploaderUrl - using explicit CDP_UPLOADER_URL: ${explicitUrl}`
    )
    return explicitUrl
  }

  const environment = process.env.ENVIRONMENT
  if (environment && environment !== 'local') {
    const derived = `https://cdp-uploader.${environment}.cdp-int.defra.cloud`
    logger.info(
      `getCdpUploaderUrl - derived from ENVIRONMENT=${environment}: ${derived}`
    )
    return derived
  }

  logger.info(
    `getCdpUploaderUrl - using local fallback, ENVIRONMENT=${environment ?? 'unset'}`
  )
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
 * Statuses explicitly returned by CDP Uploader that mean the upload has
 * permanently failed. Note: a connection/network error from getUploadStatus
 * also sets uploadStatus to 'error' but also sets an `error` field — those
 * are transient and should be retried, not treated as terminal.
 */
const TERMINAL_FAILURE_STATUSES = new Set(['rejected'])

/**
 * Poll the CDP Uploader until the upload reaches 'ready' status, then return
 * the S3 location of the uploaded file.
 *
 * Connection errors to the CDP Uploader are treated as transient and retried
 * until the timeout. Only an explicit upload failure status ('rejected') is
 * treated as a permanent failure.
 *
 * @param {string} uploadId
 * @param {{ timeoutMs?: number, pollIntervalMs?: number }} [options]
 * @returns {Promise<{bucket: string, key: string}>}
 * @throws {UploadFailedError} When CDP Uploader explicitly reports the upload failed
 * @throws {UploadTimeoutError} When the upload does not become ready within timeoutMs
 */
export async function waitForUploadReady(
  uploadId,
  { timeoutMs = 30_000, pollIntervalMs = 1_000 } = {}
) {
  const deadline = Date.now() + timeoutMs
  let attempt = 0

  while (Date.now() < deadline) {
    attempt++
    const statusResult = await getUploadStatus(uploadId)
    const { uploadStatus } = statusResult

    logger.info(
      `waitForUploadReady - uploadId: ${uploadId}, attempt: ${attempt}, status: ${uploadStatus}`
    )

    if (uploadStatus === 'ready') {
      return getUploadedFileS3Location(uploadId)
    }

    // statusResult.error means getUploadStatus caught a network/connection error
    // talking to CDP Uploader — treat as transient and keep retrying.
    if (!statusResult.error && TERMINAL_FAILURE_STATUSES.has(uploadStatus)) {
      throw new UploadFailedError(
        `Upload ${uploadId} failed with status: ${uploadStatus}`
      )
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new UploadTimeoutError(
    `Upload ${uploadId} did not reach 'ready' status within ${timeoutMs}ms`
  )
}

export class UploadFailedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UploadFailedError'
  }
}

export class UploadTimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UploadTimeoutError'
  }
}

/**
 * Get the S3 location of the uploaded file for a completed upload.
 * Returns the bucket and key for the first file in the upload (baseline uploads
 * are single-file). Throws if the upload is not complete or no file is found.
 * @param {string} uploadId - The upload ID to resolve
 * @returns {Promise<{bucket: string, key: string}>}
 */
export async function getUploadedFileS3Location(uploadId) {
  const baseUrl = getCdpUploaderUrl()
  const url = `${baseUrl}/status/${uploadId}`

  logger.info(
    `Fetching S3 location for upload - url: ${url}, uploadId: ${uploadId}`
  )

  const { payload } = await Wreck.get(url, { json: true })

  // CDP Uploader returns the file under payload.form.file (single object),
  // not in a files array as might be expected.
  const file = payload.form?.file
  if (!file) {
    throw new Error(`No file found for uploadId: ${uploadId}`)
  }

  if (!file.s3Key || !file.s3Bucket) {
    throw new Error(
      `S3 location missing for uploadId: ${uploadId} (s3Key: ${file.s3Key}, s3Bucket: ${file.s3Bucket})`
    )
  }

  logger.info(
    `Resolved S3 location - uploadId: ${uploadId}, bucket: ${file.s3Bucket}, key: ${file.s3Key}`
  )
  return { bucket: file.s3Bucket, key: file.s3Key }
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

    const file = payload.form?.file
    const errorMessage =
      file?.fileStatus === 'rejected' ? (file?.errorMessage ?? null) : null

    return {
      uploadStatus: payload.uploadStatus ?? 'unknown',
      numberOfRejectedFiles: payload.numberOfRejectedFiles ?? 0,
      errorMessage
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
