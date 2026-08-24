import { GetObjectCommand } from '@aws-sdk/client-s3'

import { config } from '../../config.js'
import { createS3Client } from './s3-client.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  logPerf,
  perfNow,
  msSince,
  memoryUsageMb
} from '../../common/helpers/perf-evidence.js'

const logger = createLogger()

/** Default download timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Maximum file size in bytes that will be downloaded. Shares the configured
 * upload limit (UPLOAD_MAX_FILE_SIZE_BYTES, default 100 MB) so this backstop
 * stays in step with the limit sent to the CDP Uploader.
 */
const MAX_FILE_SIZE_BYTES = config.get('upload.maxFileSizeBytes')

/**
 * Wording used in the timeout and failure messages for each stage. The GetObject
 * call and the body stream fail in the same two ways but are reported
 * separately, so a log line says which half of the download broke.
 */
const GET_PHASE = Object.freeze({
  timeout: 'download',
  failure: 'download failed'
})
const STREAM_PHASE = Object.freeze({
  timeout: 'stream',
  failure: 'stream error'
})

/**
 * Log an S3 failure and map it onto this module's error types. Timeouts and
 * aborts (raised by the AbortSignal.timeout passed to the SDK) become
 * S3TimeoutError; everything else becomes S3ConnectionError. Returns the error
 * for the caller to throw, so each call site stays a single `throw`.
 *
 * @param {Error} err
 * @param {{ timeout: string, failure: string }} phase GET_PHASE or STREAM_PHASE
 * @param {{ bucket: string, key: string, timeoutMs: number }} target
 * @returns {S3TimeoutError | S3ConnectionError}
 */
function mapS3Error(err, phase, { bucket, key, timeoutMs }) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    logger.warn(
      `S3 ${phase.timeout} timed out after ${timeoutMs}ms - bucket: ${bucket}, key: ${key}`
    )
    return new S3TimeoutError(
      `S3 ${phase.timeout} timed out after ${timeoutMs}ms (bucket: ${bucket}, key: ${key})`
    )
  }
  logger.error(
    `S3 ${phase.failure} - bucket: ${bucket}, key: ${key}, error: ${err.message}`
  )
  return new S3ConnectionError(
    `S3 ${phase.failure} for bucket: ${bucket}, key: ${key}: ${err.message}`
  )
}

/**
 * Issue the GetObject call, aborting it once the timeout elapses.
 *
 * @param {{ send: Function }} client
 * @param {{ bucket: string, key: string, timeoutMs: number }} target
 * @returns {Promise<object>} the SDK response, body not yet consumed
 */
async function getS3Object(client, target) {
  const { bucket, key, timeoutMs } = target
  try {
    return await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(timeoutMs) }
    )
  } catch (err) {
    throw mapS3Error(err, GET_PHASE, target)
  }
}

/**
 * Reject an object larger than the configured limit before its body is read.
 *
 * @param {object} response
 * @param {{ bucket: string, key: string }} target
 * @throws {S3FileTooLargeError}
 */
function assertWithinSizeLimit(response, { bucket, key }) {
  const contentLength = Number(response.ContentLength)
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES) {
    logger.warn(
      `S3 object exceeds size limit - bucket: ${bucket}, key: ${key}, contentLength: ${contentLength}, maxBytes: ${MAX_FILE_SIZE_BYTES}`
    )
    throw new S3FileTooLargeError(
      `S3 object size ${contentLength} exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes (bucket: ${bucket}, key: ${key})`
    )
  }
}

/**
 * Evidence (Item 4 — the whole file is buffered into memory, up to 100 MB):
 * the S3 object is accumulated into a single Buffer held for the request
 * lifecycle, later coexisting with the decoded GeoJSON feature arrays.
 *
 * Reported as rss/external/arrayBuffers, NOT heapUsed: Node allocates Buffer
 * bytes outside the V8 heap, so a 100 MB download barely moves heapUsed and
 * a heap-only delta made this look free. rss is what an ECS task's memory
 * limit is measured against; external/arrayBuffers say where it went.
 *
 * @param {Buffer} buffer
 * @param {{ rssMb: number, heapUsedMb: number, externalMb: number, arrayBuffersMb: number }} before
 * @param {number} bufferStart a perfNow() reading taken before the read began
 */
function logBufferedMemory(buffer, before, bufferStart) {
  const after = memoryUsageMb()
  logPerf(logger, 'file-buffered-memory', {
    bytes: buffer.byteLength,
    rssBeforeMb: before.rssMb,
    rssAfterMb: after.rssMb,
    rssDeltaMb: after.rssMb - before.rssMb,
    externalDeltaMb: after.externalMb - before.externalMb,
    arrayBuffersDeltaMb: after.arrayBuffersMb - before.arrayBuffersMb,
    heapUsedDeltaMb: after.heapUsedMb - before.heapUsedMb,
    bufferMs: msSince(bufferStart)
  })
}

/**
 * Read the response body stream into a single Buffer.
 *
 * @param {object} response
 * @param {{ bucket: string, key: string, timeoutMs: number }} target
 * @returns {Promise<Buffer>}
 */
async function bufferResponseBody(response, target) {
  const bufferStart = perfNow()
  const before = memoryUsageMb()
  try {
    const chunks = []
    for await (const chunk of response.Body) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    logBufferedMemory(buffer, before, bufferStart)
    return buffer
  } catch (err) {
    throw mapS3Error(err, STREAM_PHASE, target)
  }
}

/**
 * Download a file from S3 and return its contents as a Buffer.
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Buffer>}
 * @throws {S3FileTooLargeError} When the object exceeds MAX_DOWNLOAD_BYTES
 * @throws {S3TimeoutError} When the download exceeds the timeout
 * @throws {S3ConnectionError} When S3 cannot be reached or returns an error
 */
async function downloadFile(
  bucket,
  key,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const client = createS3Client()
  logger.info(
    `Downloading S3 object - bucket: ${bucket}, key: ${key}, timeoutMs: ${timeoutMs}`
  )

  const target = { bucket, key, timeoutMs }
  const response = await getS3Object(client, target)
  assertWithinSizeLimit(response, target)
  const buffer = await bufferResponseBody(response, target)

  logger.info(
    `Downloaded S3 object - bucket: ${bucket}, key: ${key}, size: ${buffer.byteLength} bytes`
  )
  return buffer
}

class S3FileTooLargeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'S3FileTooLargeError'
  }
}

class S3TimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'S3TimeoutError'
  }
}

class S3ConnectionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'S3ConnectionError'
  }
}

export {
  downloadFile,
  S3FileTooLargeError,
  S3TimeoutError,
  S3ConnectionError,
  DEFAULT_TIMEOUT_MS,
  MAX_FILE_SIZE_BYTES
}
