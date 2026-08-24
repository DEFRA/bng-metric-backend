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

  const signal = AbortSignal.timeout(timeoutMs)

  let response
  try {
    response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: signal }
    )
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      logger.warn(
        `S3 download timed out after ${timeoutMs}ms - bucket: ${bucket}, key: ${key}`
      )
      throw new S3TimeoutError(
        `S3 download timed out after ${timeoutMs}ms (bucket: ${bucket}, key: ${key})`
      )
    }
    logger.error(
      `S3 download failed - bucket: ${bucket}, key: ${key}, error: ${err.message}`
    )
    throw new S3ConnectionError(
      `S3 download failed for bucket: ${bucket}, key: ${key}: ${err.message}`
    )
  }

  const contentLength = Number(response.ContentLength)
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES) {
    logger.warn(
      `S3 object exceeds size limit - bucket: ${bucket}, key: ${key}, contentLength: ${contentLength}, maxBytes: ${MAX_FILE_SIZE_BYTES}`
    )
    throw new S3FileTooLargeError(
      `S3 object size ${contentLength} exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes (bucket: ${bucket}, key: ${key})`
    )
  }

  const bufferStart = perfNow()
  const before = memoryUsageMb()
  try {
    const chunks = []
    for await (const chunk of response.Body) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    // Evidence (Item 4 — the whole file is buffered into memory, up to 100 MB):
    // the S3 object is accumulated into a single Buffer held for the request
    // lifecycle, later coexisting with the decoded GeoJSON feature arrays.
    //
    // Reported as rss/external/arrayBuffers, NOT heapUsed: Node allocates Buffer
    // bytes outside the V8 heap, so a 100 MB download barely moves heapUsed and
    // a heap-only delta made this look free. rss is what an ECS task's memory
    // limit is measured against; external/arrayBuffers say where it went.
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
    logger.info(
      `Downloaded S3 object - bucket: ${bucket}, key: ${key}, size: ${buffer.byteLength} bytes`
    )
    return buffer
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      logger.warn(
        `S3 stream timed out after ${timeoutMs}ms - bucket: ${bucket}, key: ${key}`
      )
      throw new S3TimeoutError(
        `S3 stream timed out after ${timeoutMs}ms (bucket: ${bucket}, key: ${key})`
      )
    }
    logger.error(
      `S3 stream error - bucket: ${bucket}, key: ${key}, error: ${err.message}`
    )
    throw new S3ConnectionError(
      `S3 stream error for bucket: ${bucket}, key: ${key}: ${err.message}`
    )
  }
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
