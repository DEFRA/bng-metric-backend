import { S3Client } from '@aws-sdk/client-s3'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Creates an S3Client configured from convict: {@link config} `aws.region`, and
 * optionally `s3.endpoint` + `s3.forcePathStyle` for LocalStack in development.
 * Credentials are not set here; the SDK default provider chain uses env / IAM.
 * @returns {S3Client}
 */
function createS3Client() {
  const options = {
    region: config.get('aws.region')
  }

  const endpoint = config.get('s3.endpoint')
  if (endpoint) {
    options.endpoint = endpoint
    options.forcePathStyle = config.get('s3.forcePathStyle')
    logger.info(`S3 client using custom endpoint: ${endpoint}`)
  } else {
    logger.info('S3 client using default AWS endpoint (no s3.endpoint)')
  }

  return new S3Client(options)
}

export { createS3Client }
