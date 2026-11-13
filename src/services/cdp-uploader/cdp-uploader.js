import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { uploaderGet, uploaderPost } from './uploader-http.js'

const logger = createLogger()

// The Wreck calls in uploader-http.js DO go through the outbound proxy when
// HTTP_PROXY is set.
// Wreck calls Node's http/https `request` at request time, and setupProxy()
// (common/helpers/proxy/setup-proxy.js) bootstraps global-agent, which
// replaces those functions and forces its proxying agent over the one Wreck
// passes. Its no-proxy list is GLOBAL_AGENT_NO_PROXY, which is not set. The
// CDP production readiness review read these calls as bypassing the proxy
// (BMD-1174); they do not.

/**
 * Longest one call to the CDP Uploader may take. Below the frontend's backend
 * timeout, so a hung uploader fails here, with a logged reason, rather than
 * holding the request open for as long as the hang lasts (BMD-1200).
 * @returns {number}
 */
function requestTimeoutMs() {
  return config.get('cdpUploader.requestTimeoutMs')
}

/**
 * The timeout for one call made before `deadline`: the per-call timeout, or the
 * time left if that is less. Never 0, which Wreck reads as "no timeout".
 * @param {number} deadline epoch milliseconds
 * @returns {number}
 */
function callTimeoutBefore(deadline) {
  return Math.max(1, Math.min(requestTimeoutMs(), deadline - Date.now()))
}

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
  const maxFileSize = config.get('upload.maxFileSizeBytes')

  // cdp-uploader joins s3Path + '/' + uploadId + '/' + fileId, so any trailing
  // slash on s3Path produces a double slash in the resulting s3Key.
  let normalisedS3Path = s3Path
  while (normalisedS3Path?.endsWith('/')) {
    normalisedS3Path = normalisedS3Path.slice(0, -1)
  }

  logger.info(
    `Initiating upload - url: ${url}, redirect: ${redirect}, s3Bucket: ${s3Bucket}, s3Path: ${normalisedS3Path}`
  )

  try {
    const { payload } = await uploaderPost(
      url,
      {
        payload: JSON.stringify({
          redirect,
          s3Bucket,
          s3Path: normalisedS3Path,
          metadata,
          // CDP Uploader rejects files larger than this at source (HTTP 413 on
          // the upload POST) before they ever reach S3.
          maxFileSize
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      },
      requestTimeoutMs()
    )

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
 * Legacy top-level statuses that mean the upload permanently failed. In practice
 * the real CDP Uploader does NOT expose a top-level 'rejected' status for a virus
 * — it reports the upload as 'ready' with numberOfRejectedFiles > 0 and the
 * reason on the per-file errorMessage (see waitForUploadReady). This set is kept
 * as a defensive fallback should an uploader version ever surface one. A
 * connection / network error from getUploadStatus also produces an 'error'
 * uploadStatus but additionally sets an `error` field — those are transient and
 * should be retried, so we check that field separately below.
 */
const TERMINAL_FAILURE_STATUSES = new Set(['rejected'])

/**
 * Poll the CDP Uploader until the upload reaches 'ready' status, then return
 * the S3 location of the uploaded file, read from that same 'ready' status.
 *
 * Connection errors are treated as transient and retried until the timeout.
 * An explicit terminal status (e.g. 'rejected') fails fast — there's no
 * point waiting 30 s for an answer CDP has already given us.
 *
 * Nothing here runs past the deadline: each status check gets the smaller of
 * its own timeout and the time left, and so does the pause between checks. The
 * deadline is a rung of the validate route's timeout ladder
 * (docs/geometry-validation.md). The location comes from the 'ready' answer
 * itself, so there is no second call to time out after it.
 *
 * @param {string} uploadId
 * @param {{ timeoutMs?: number, pollIntervalMs?: number }} [options]
 * @returns {Promise<{bucket: string, key: string, filename: string|null, fileSize: number|null}>}
 * @throws {UploadFailedError} When CDP Uploader reports the upload was rejected
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
    const { status: statusResult, file } = await checkUploadStatus(
      uploadId,
      callTimeoutBefore(deadline)
    )
    const { uploadStatus } = statusResult

    logger.info(
      `waitForUploadReady - uploadId: ${uploadId}, attempt: ${attempt}, status: ${uploadStatus}`
    )

    // A virus / rejected file surfaces as the upload COMPLETING — uploadStatus
    // becomes 'ready' — with numberOfRejectedFiles > 0 and the reason on the
    // per-file errorMessage; the rejected file is never copied to S3, so it has
    // no s3Key. Detect that (and the legacy top-level 'rejected' fallback) BEFORE
    // the 'ready' branch, which would otherwise try to resolve a non-existent S3
    // location and throw a generic, mis-classified error. statusResult.error
    // means checkUploadStatus hit a transient connection problem — keep retrying.
    if (
      !statusResult.error &&
      (statusResult.numberOfRejectedFiles > 0 ||
        TERMINAL_FAILURE_STATUSES.has(uploadStatus))
    ) {
      throw new UploadFailedError(
        `Upload ${uploadId} was rejected by CDP Uploader`,
        statusResult.errorMessage ?? null
      )
    }

    if (uploadStatus === 'ready') {
      return s3LocationFrom(file, uploadId)
    }

    const pauseMs = Math.min(pollIntervalMs, deadline - Date.now())
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, pauseMs)))
  }

  throw new UploadTimeoutError(
    `Upload ${uploadId} did not reach 'ready' status within ${timeoutMs}ms`
  )
}

export class UploadFailedError extends Error {
  /**
   * @param {string} message
   * @param {string|null} [errorMessage] - the rejection reason reported by CDP
   *   Uploader (e.g. "The selected file contains a virus"), used to categorise
   *   the failure metric.
   */
  constructor(message, errorMessage = null) {
    super(message)
    this.name = 'UploadFailedError'
    this.errorMessage = errorMessage
  }
}

export class UploadTimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UploadTimeoutError'
  }
}

/**
 * The S3 location of a completed upload's file, from its status answer.
 * CDP Uploader returns the file under payload.form.file (single object), not in
 * a files array as might be expected; baseline uploads are single-file.
 * @param {object|undefined} file - payload.form.file of a status answer
 * @param {string} uploadId
 * @returns {{bucket: string, key: string, filename: string|null, fileSize: number|null}}
 */
function s3LocationFrom(file, uploadId) {
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
  return {
    bucket: file.s3Bucket,
    key: file.s3Key,
    filename: file.filename ?? null,
    fileSize: file.contentLength ?? null
  }
}

/**
 * Get the S3 location of the uploaded file for a completed upload.
 * Returns the bucket and key for the first file in the upload (baseline uploads
 * are single-file). Throws if the upload is not complete or no file is found.
 * @param {string} uploadId - The upload ID to resolve
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{bucket: string, key: string, filename: string|null, fileSize: number|null}>}
 */
export async function getUploadedFileS3Location(
  uploadId,
  { timeoutMs = requestTimeoutMs() } = {}
) {
  const baseUrl = getCdpUploaderUrl()
  const url = `${baseUrl}/status/${uploadId}`

  logger.info(
    `Fetching S3 location for upload - url: ${url}, uploadId: ${uploadId}`
  )

  const { payload } = await uploaderGet(url, timeoutMs)
  return s3LocationFrom(payload.form?.file, uploadId)
}

/**
 * Ask CDP Uploader for an upload's status. Returns the status a caller may see,
 * and the file the answer names, which holds its S3 location and stays inside
 * this module: the status route hands `status` to the browser as it is.
 * @param {string} uploadId
 * @param {number} timeoutMs the whole call
 * @returns {Promise<{status: {uploadStatus: string, numberOfRejectedFiles?: number, errorMessage?: string|null, error?: string}, file?: object}>}
 */
async function checkUploadStatus(uploadId, timeoutMs) {
  const baseUrl = getCdpUploaderUrl()
  const url = `${baseUrl}/status/${uploadId}`

  logger.info(`Fetching upload status - url: ${url}, uploadId: ${uploadId}`)

  try {
    const { payload } = await uploaderGet(url, timeoutMs)

    const file = payload.form?.file
    const errorMessage =
      file?.fileStatus === 'rejected' ? (file?.errorMessage ?? null) : null

    return {
      status: {
        uploadStatus: payload.uploadStatus ?? 'unknown',
        numberOfRejectedFiles: payload.numberOfRejectedFiles ?? 0,
        errorMessage
      },
      file
    }
  } catch (error) {
    const statusCode = error?.output?.statusCode
    const responsePayload = error?.data?.payload
    logger.error(
      `Error fetching upload status - url: ${url}, baseUrl: ${baseUrl}, uploadId: ${uploadId}, statusCode: ${statusCode}, responsePayload: ${JSON.stringify(responsePayload)}, message: ${error?.message}`
    )
    return {
      status: {
        uploadStatus: 'error',
        error: 'Unable to check upload status'
      }
    }
  }
}

/**
 * Get the upload status from CDP Uploader
 * @param {string} uploadId - The upload ID to check status for
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{uploadStatus: string, error?: string}>}
 */
export async function getUploadStatus(
  uploadId,
  { timeoutMs = requestTimeoutMs() } = {}
) {
  const { status } = await checkUploadStatus(uploadId, timeoutMs)
  return status
}
