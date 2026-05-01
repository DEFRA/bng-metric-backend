import { S3Client } from '@aws-sdk/client-s3'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/** Default LocalStack gateway when running the API on the host (not in Docker). */
const DEFAULT_LOCALSTACK_ENDPOINT = 'http://localhost:4566' // NOSONAR: LocalStack uses HTTP in local dev

/** Matches compose/aws.env and CDP; used when AWS_REGION is unset (e.g. bare `npm run dev`). */
const DEFAULT_AWS_REGION = 'eu-west-2'

/**
 * Creates an S3Client configured for the current environment.
 * Region comes from AWS_REGION / AWS_DEFAULT_REGION (aws.env/CDP), with an
 * eu-west-2 fallback for local host dev when those are unset.
 * Local: endpoint from AWS_ENDPOINT_URL (or localhost default); credentials
 * from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY when set (aws.env), otherwise
 * LocalStack dummy test/test for bare `npm run dev`.
 * Non-local: IAM via the SDK default provider chain only — not convict.
 * @returns {S3Client}
 */
function createS3Client() {
  const environment = config.get('cdpEnvironment')
  const isLocal = environment === 'local'
  const region = config.get('aws.region') ?? DEFAULT_AWS_REGION

  if (isLocal) {
    const endpoint = process.env.AWS_ENDPOINT_URL ?? DEFAULT_LOCALSTACK_ENDPOINT
    logger.info(`S3 client using local endpoint: ${endpoint}`)

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? 'test'
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? 'test'

    return new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    })
  }

  logger.info(
    `S3 client using default AWS SDK resolution for environment: ${environment}`
  )
  return new S3Client({ region })
}

export { createS3Client }
