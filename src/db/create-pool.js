import Pool from 'pg-pool'
import { Signer } from '@aws-sdk/rds-signer'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const CONNECTION_TIMEOUT_MS = 10000
const IDLE_TIMEOUT_MS = 30000
const MAX_LIFETIME_SECONDS = 60 * 10
const DEFAULT_MAX_POOL_SIZE = 10

function createPasswordProvider(options) {
  if (options.iamAuthentication) {
    return async () => {
      logger.info('Requesting new IAM RDS token')
      try {
        const signer = new Signer({
          region: options.region,
          hostname: options.host,
          port: options.port,
          username: options.user,
          credentials: fromNodeProviderChain()
        })
        const token = await signer.getAuthToken()
        logger.info('IAM RDS token obtained successfully')
        return token
      } catch (error) {
        logger.error(`Failed to obtain IAM RDS token: ${error.message}`)
        throw error
      }
    }
  }

  return () => options.localPassword
}

// Build a pg Pool from plain options (no Hapi server required) so that both the
// `postgres` plugin and the standalone baseline validation worker thread create
// identical pools from the same config.get('postgres.*') values. For IAM auth in
// the cloud the caller must pass `secureContext` (the plugin sources it from
// @defra/hapi-secure-context); a bare worker without one cannot use IAM SSL.
function createPool(options) {
  const passwordProvider = createPasswordProvider(options)
  return new Pool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: passwordProvider,
    database: options.database,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: MAX_LIFETIME_SECONDS,
    max: options.max ?? DEFAULT_MAX_POOL_SIZE,
    ...(options.iamAuthentication &&
      options.secureContext && {
        ssl: {
          rejectUnauthorized: false,
          secureContext: options.secureContext
        }
      })
  })
}

export { createPool, createPasswordProvider }
