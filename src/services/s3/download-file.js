import { GetObjectCommand } from '@aws-sdk/client-s3'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const TEMP_DIR_PREFIX = 's3-download-'
const TEMP_FILENAME = 'download.bin'

/**
 * Issue the GetObject call, mapping SDK failures onto our error types.
 *
 * @returns {Promise<import('@aws-sdk/client-s3').GetObjectCommandOutput>}
 */
async function getObject(client, bucket, key, signal, timeoutMs) {
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
 * Reject an oversized object from its declared Content-Length, before a single
 * byte is streamed. The byte counter in {@link countingChunks} is the backstop
 * for objects that arrive without one.
 */
function assertDeclaredSizeWithinLimit(response, bucket, key) {
  const contentLength = Number(response.ContentLength)
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES) {
    logger.warn(
      `S3 object exceeds size limit - bucket: ${bucket}, key: ${key}, contentLength: ${contentLength}, maxBytes: ${MAX_FILE_SIZE_BYTES}`
    )
    throw tooLargeError(bucket, key, contentLength)
  }
}

/**
 * Pass the body through chunk by chunk, tallying bytes into `counter` and
 * aborting the moment the running total passes the limit — so an object that
 * lied about (or omitted) its Content-Length still cannot fill the disk.
 */
async function* countingChunks(body, bucket, key, counter) {
  for await (const chunk of body) {
    counter.bytes += chunk.length
    if (counter.bytes > MAX_FILE_SIZE_BYTES) {
      logger.warn(
        `S3 stream exceeded size limit - bucket: ${bucket}, key: ${key}, maxBytes: ${MAX_FILE_SIZE_BYTES}`
      )
      throw tooLargeError(bucket, key, counter.bytes)
    }
    yield chunk
  }
}

/**
 * Stream the response body to `filePath`, one chunk at a time. Nothing larger
 * than a single chunk is ever resident, so a 100 MB object costs 100 MB of
 * disk rather than 100 MB of memory.
 *
 * @returns {Promise<number>} bytes written
 */
async function streamBodyToFile(response, filePath, bucket, key, timeoutMs) {
  const counter = { bytes: 0 }
  try {
    await pipeline(
      countingChunks(response.Body, bucket, key, counter),
      createWriteStream(filePath)
    )
    return counter.bytes
  } catch (err) {
    if (err instanceof S3FileTooLargeError) {
      throw err
    }
    if (isAbortLike(err)) {
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

/**
 * Download a file from S3 by streaming it straight to a temporary file.
 *
 * The object is never held in memory as a Buffer (BMD-913): concurrent
 * uploads would otherwise each keep a full copy of their file in memory —
 * up to the 100 MB upload limit apiece — and a handful of them at once could
 * OOM the whole process.
 *
 * The caller owns the returned file and **must** call `cleanup()` when done,
 * whatever the outcome.
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ path: string, size: number, cleanup: () => Promise<void> }>}
 * @throws {S3FileTooLargeError} When the object exceeds MAX_FILE_SIZE_BYTES
 * @throws {S3TimeoutError} When the download exceeds the timeout
 * @throws {S3ConnectionError} When S3 cannot be reached or returns an error
 */
async function downloadFileToTemp(
  bucket,
  key,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const client = createS3Client()
  logger.info(
    `Downloading S3 object - bucket: ${bucket}, key: ${key}, timeoutMs: ${timeoutMs}`
  )

  const signal = AbortSignal.timeout(timeoutMs)
  const response = await getObject(client, bucket, key, signal, timeoutMs)
  assertDeclaredSizeWithinLimit(response, bucket, key)

  const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX))
  const filePath = join(dir, TEMP_FILENAME)
  const cleanup = () => rm(dir, { recursive: true, force: true })

  try {
    const size = await streamBodyToFile(
      response,
      filePath,
      bucket,
      key,
      timeoutMs
    )
    logger.info(
      `Downloaded S3 object to disk - bucket: ${bucket}, key: ${key}, size: ${size} bytes`
    )
    return { path: filePath, size, cleanup }
  } catch (err) {
    // The download already failed; a failure to tidy up after it must not
    // replace the error the caller needs to see.
    await cleanup().catch((cleanupErr) => {
      logger.warn(
        `Failed to remove partial S3 download at ${dir}: ${cleanupErr.message}`
      )
    })
    throw err
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
  downloadFileToTemp,
  S3FileTooLargeError,
  S3TimeoutError,
  S3ConnectionError,
  DEFAULT_TIMEOUT_MS,
  MAX_FILE_SIZE_BYTES
}
