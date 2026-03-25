import Pool from 'pg-pool'
import { Signer } from '@aws-sdk/rds-signer'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

function createPasswordProvider(options) {
  if (options.iamAuthentication) {
    return async () => {
      logger.info('Requesting new IAM RDS token')
      const signer = new Signer({
        region: options.region,
        hostname: options.host,
        port: options.port,
        username: options.user,
        credentials: fromNodeProviderChain()
      })
      return await signer.getAuthToken()
    }
  }

  return () => options.localPassword
}

const postgres = {
  plugin: {
    name: 'postgres',
    version: '1.0.0',
    register: function (server, options) {
      server.logger.info('Setting up Postgres')

      const passwordProvider = createPasswordProvider(options)
      const pool = new Pool({
        host: options.host,
        port: options.port,
        user: options.user,
        password: passwordProvider,
        database: options.database,
        maxLifetimeSeconds: 60 * 10,
        ...(options.iamAuthentication &&
          server.secureContext && {
            ssl: {
              rejectUnauthorized: false,
              secureContext: server.secureContext
            }
          })
      })

      server.logger.info(`Postgres connected to database '${options.database}'`)

      server.decorate('server', 'pg', pool)
      server.decorate('request', 'pg', pool)
    }
  }
}

export { postgres }
