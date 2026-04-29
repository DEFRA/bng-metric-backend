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
    const endpoint = config.get('aws.endpointUrl') ?? 'http://localhost:4566'
    logger.info(`S3 client using local endpoint: ${endpoint}`)
    return new S3Client({
      region: config.get('aws.region'),
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('aws.accessKeyId'),
        secretAccessKey: config.get('aws.secretAccessKey')
      }
    })
  }

  logger.info(
    `S3 client using provider chain credentials for environment: ${environment}`
  )
  return new S3Client({
    region: config.get('aws.region'),
    credentials: fromNodeProviderChain()
  })
}

export { createS3Client }
