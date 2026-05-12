import Database from 'better-sqlite3'

import { config } from '../../config.js'
import { createLogger } from './logging/logger.js'

import { createServer } from '../../server.js'

const logger = createLogger()

// We use better-sqlite3 to read uploaded GeoPackage files.
// better-sqlite3 ships a Node-major-pinned native .node addon; rebuild after Node-version changes.
function assertBetterSqliteLoadable() {
  try {
    new Database(':memory:').close()
    logger.info('better-sqlite3 native binding loaded OK')
  } catch (err) {
    if (err.message.includes('NODE_MODULE_VERSION')) {
      throw new Error(
        `better-sqlite3 native binding mismatches the running Node version. ` +
          `Run 'npm rebuild better-sqlite3' from the project root.\n\n${err.message}`
      )
    }
    throw err
  }
}

async function startServer() {
  assertBetterSqliteLoadable()

  const server = await createServer()
  await server.start()

  server.logger.info('Server started successfully')
  server.logger.info(
    `Access your backend on http://localhost:${config.get('port')}`
  )

  return server
}

export { startServer }
