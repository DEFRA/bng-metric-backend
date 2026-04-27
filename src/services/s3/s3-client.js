import { S3Client } from '@aws-sdk/client-s3'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Creates an S3Client configured for the current environment.
 * In production, uses the node provider chain (ECS task role / instance profile).
 * Locally, points at localstack.
 * @returns {S3Client}
 */
function createS3Client() {
  const environment = config.get('cdpEnvironment')
  const isLocal = environment === 'local'

  if (isLocal) {
    const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566'
    logger.info(`S3 client using local endpoint: ${endpoint}`)
    return new S3Client({
      region: process.env.AWS_REGION ?? 'eu-west-2',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test'
      }
    })
  }

  logger.info(
    `S3 client using provider chain credentials for environment: ${environment}`
  )
  return new S3Client({
    region: process.env.AWS_REGION ?? 'eu-west-2',
    credentials: fromNodeProviderChain()
  })
}

export { createS3Client }
