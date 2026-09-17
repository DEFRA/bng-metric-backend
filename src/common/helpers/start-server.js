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

// geos-wasm is the one dependency no import at boot can vouch for: it is only
// ever imported inside the validation worker threads, and the first of those
// is spawned by the first upload. A missing package — a pull without an
// npm install — would otherwise let the service run for hours and only fail,
// fatally, on a user's request (the worker pool shuts the process down when a
// worker cannot load its modules; see validation/geopackage/geos/worker-pool.js).
// Resolution-only on purpose: compiling the WebAssembly stays the workers' job,
// so boot pays for a node_modules lookup and nothing more.
function assertGeosWasmResolvable(resolve = (s) => import.meta.resolve(s)) {
  try {
    resolve('geos-wasm')
    logger.info('geos-wasm package resolved OK')
  } catch (err) {
    throw new Error(
      `geos-wasm cannot be resolved — this install is incomplete. ` +
        `Run 'npm install' from the project root.\n\n${err.message}`
    )
  }
}

async function startServer() {
  assertBetterSqliteLoadable()
  assertGeosWasmResolvable()

  const server = await createServer()
  await server.start()

  server.logger.info('Server started successfully')
  server.logger.info(
    `Access your backend on http://localhost:${config.get('port')}`
  )

  return server
}

export { startServer, assertGeosWasmResolvable }
