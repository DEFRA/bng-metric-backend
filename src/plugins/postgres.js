import Pool from 'pg-pool'
import { Signer } from '@aws-sdk/rds-signer'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

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

const postgres = {
  plugin: {
    name: 'postgres',
    version: '1.0.0',
    register: async function (server, options) {
      server.logger.info(
        `Setting up Postgres pool for ${options.host}:${options.port}/${options.database}`
      )

      const passwordProvider = createPasswordProvider(options)
      const pool = new Pool({
        host: options.host,
        port: options.port,
        user: options.user,
        password: passwordProvider,
        database: options.database,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        maxLifetimeSeconds: 60 * 10,
        max: 10,
        ...(options.iamAuthentication &&
          server.secureContext && {
            ssl: {
              rejectUnauthorized: false,
              secureContext: server.secureContext
            }
          })
      })

      pool.on('error', (error) => {
        logger.error(`Postgres pool error: ${error.message}`)
      })

      pool.on('connect', () => {
        logger.info('Postgres pool created new connection')
      })

      // Verify connectivity at startup rather than failing on first request
      try {
        const client = await pool.connect()
        const result = await client.query('SELECT 1 AS ok')
        client.release()
        server.logger.info(
          `Postgres connected to database '${options.database}' (verified: ${result.rows[0].ok === 1})`
        )
      } catch (error) {
        server.logger.error(
          `Postgres failed to connect to '${options.database}': ${error.message}`
        )
        throw error
      }

      server.decorate('server', 'pg', pool)
      server.decorate('request', 'pg', pool)
    }
  }
}

export { postgres }
