import { createLogger } from '../common/helpers/logging/logger.js'
import { createDrizzle } from '../db/index.js'
import { createPool } from '../db/create-pool.js'

const logger = createLogger()

const postgres = {
  plugin: {
    name: 'postgres',
    version: '1.0.0',
    register: async function (server, options) {
      server.logger.info(
        `Setting up Postgres pool for ${options.host}:${options.port}/${options.database}`
      )

      // secureContext is only present in the cloud (loaded by
      // @defra/hapi-secure-context); it enables IAM-auth SSL in create-pool.js.
      const pool = createPool({
        ...options,
        secureContext: server.secureContext
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

      const db = createDrizzle(pool)

      server.decorate('server', 'pg', pool)
      server.decorate('request', 'pg', pool)
      server.decorate('server', 'drizzle', db)
      server.decorate('request', 'drizzle', db)
    }
  }
}

export { postgres }
