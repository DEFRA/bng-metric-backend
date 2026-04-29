import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

// MERGE NOTE (PR #16): superseded by s3-client.js + download-file.js. Move
// the s3.endpoint/forcePathStyle wiring across, and add a download-to-path
// variant — better-sqlite3 needs a file path, not a Buffer.

const logger = createLogger()

let cachedClient = null

function getS3Client() {
  if (cachedClient) {
    return cachedClient
  }
  const region = config.get('aws.region')
  const endpoint = config.get('s3.endpoint')
  const options = { region }
  if (endpoint) {
    options.endpoint = endpoint
    options.forcePathStyle = config.get('s3.forcePathStyle')
  }
  cachedClient = new S3Client(options)
  logger.info(
    `S3 client initialised - region: ${region}, endpoint: ${endpoint ?? 'default'}`
  )
  return cachedClient
}

/**
 * Download an object from S3 to a local file path.
 *
 * @param {{ bucket: string, key: string, destination: string }} params
 */
export async function downloadObject({ bucket, key, destination }) {
  const client = getS3Client()
  logger.info(`Downloading s3://${bucket}/${key} → ${destination}`)
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  )
  await pipeline(response.Body, fs.createWriteStream(destination))
}
