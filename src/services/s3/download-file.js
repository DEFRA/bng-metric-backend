import { GetObjectCommand } from '@aws-sdk/client-s3'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { config } from '../../config.js'
import { createS3Client } from './s3-client.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

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
 * Issue the GetObject request, mapping SDK failures onto our error types.
 *
 * @param {import('@aws-sdk/client-s3').S3Client} client
 * @param {{ bucket: string, key: string, timeoutMs: number, signal: AbortSignal }} request
 */
async function getObject(client, { bucket, key, timeoutMs, signal }) {
  try {
    return await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: signal }
    )
  } catch (err) {
    if (isAbortLike(err)) {
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
}

function isAbortLike(err) {
  return err.name === 'TimeoutError' || err.name === 'AbortError'
}

function tooLargeError(bucket, key, size) {
  return new S3FileTooLargeError(
    `S3 object size ${size} exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes (bucket: ${bucket}, key: ${key})`
  )
}

/**
 * Reject on the size S3 advertises, before a byte is transferred. ContentLength
 * is server-supplied metadata, so the streamed guard below is what actually
 * bounds what we write — this only saves us the transfer when it is honest.
 */
function assertAdvertisedSizeWithinLimit(response, bucket, key) {
  const contentLength = Number(response.ContentLength)
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES) {
    logger.warn(
      `S3 object exceeds size limit - bucket: ${bucket}, key: ${key}, contentLength: ${contentLength}, maxBytes: ${MAX_FILE_SIZE_BYTES}`
    )
    throw tooLargeError(bucket, key, contentLength)
  }
}

/**
 * Pass-through that counts bytes and fails the stream the moment the limit is
 * passed, so an object larger than it advertised cannot fill the disk.
 *
 * @param {string} bucket
 * @param {string} key
 * @param {{ bytes: number }} counter written to as the body flows
 */
function createSizeGuard(bucket, key, counter) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      counter.bytes += chunk.length
      if (counter.bytes > MAX_FILE_SIZE_BYTES) {
        logger.warn(
          `S3 object exceeds size limit mid-stream - bucket: ${bucket}, key: ${key}, bytesRead: ${counter.bytes}, maxBytes: ${MAX_FILE_SIZE_BYTES}`
        )
        callback(tooLargeError(bucket, key, counter.bytes))
        return
      }
      callback(null, chunk)
    }
  })
}

function mapStreamError(err, bucket, key, timeoutMs) {
  if (err instanceof S3FileTooLargeError) {
    return err
  }
  if (isAbortLike(err)) {
    logger.warn(
      `S3 stream timed out after ${timeoutMs}ms - bucket: ${bucket}, key: ${key}`
    )
    return new S3TimeoutError(
      `S3 stream timed out after ${timeoutMs}ms (bucket: ${bucket}, key: ${key})`
    )
  }
  logger.error(
    `S3 stream error - bucket: ${bucket}, key: ${key}, error: ${err.message}`
  )
  return new S3ConnectionError(
    `S3 stream error for bucket: ${bucket}, key: ${key}: ${err.message}`
  )
}

/**
 * Download a file from S3 straight to disk.
 *
 * The object is streamed to `destPath` rather than collected into a Buffer, so
 * an upload never occupies heap proportional to its size and concurrent
 * downloads cannot multiply into an out-of-memory kill (BMD-913).
 *
 * On any failure the partial file is removed, so a caller that catches and
 * retries never opens a truncated GeoPackage.
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} destPath - local path to write the object to
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ bytes: number }>} bytes written to destPath
 * @throws {S3FileTooLargeError} When the object exceeds MAX_FILE_SIZE_BYTES
 * @throws {S3TimeoutError} When the download exceeds the timeout
 * @throws {S3ConnectionError} When S3 cannot be reached or returns an error
 */
async function downloadFileToPath(
  bucket,
  key,
  destPath,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const client = createS3Client()
  logger.info(
    `Downloading S3 object - bucket: ${bucket}, key: ${key}, destPath: ${destPath}, timeoutMs: ${timeoutMs}`
  )

  const signal = AbortSignal.timeout(timeoutMs)
  const response = await getObject(client, { bucket, key, timeoutMs, signal })
  assertAdvertisedSizeWithinLimit(response, bucket, key)

  const counter = { bytes: 0 }
  try {
    await pipeline(
      response.Body,
      createSizeGuard(bucket, key, counter),
      createWriteStream(destPath),
      { signal }
    )
  } catch (err) {
    await rm(destPath, { force: true }).catch(() => {})
    throw mapStreamError(err, bucket, key, timeoutMs)
  }

  logger.info(
    `Downloaded S3 object - bucket: ${bucket}, key: ${key}, size: ${counter.bytes} bytes`
  )
  return { bytes: counter.bytes }
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
  downloadFileToPath,
  S3FileTooLargeError,
  S3TimeoutError,
  S3ConnectionError,
  DEFAULT_TIMEOUT_MS,
  MAX_FILE_SIZE_BYTES
}
