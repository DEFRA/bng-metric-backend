import process from 'node:process'

/**
 * Grace between deciding to die and actually exiting, so the fatal log line
 * survives: the pino-pretty transport writes from a worker thread, and an
 * immediate `process.exit` can drop exactly the message that says why the
 * service went down.
 */
export const FATAL_EXIT_FLUSH_MS = 1000

/**
 * End the process with exit code 1 once the logger has had time to flush.
 * Sets `process.exitCode` at once, so an exit that happens first for any other
 * reason still reports the failure.
 */
export function exitProcessAfterFlush() {
  process.exitCode = 1
  setTimeout(() => process.exit(1), FATAL_EXIT_FLUSH_MS)
}

/**
 * Long enough for in-flight requests to finish, matching the timeout
 * hapi-pulse gives `server.stop` on SIGTERM.
 */
export const FATAL_STOP_TIMEOUT_MS = 10 * 1000

/**
 * Build the handler for a fatal error the process cannot recover from, such as
 * an unhandled rejection. The first call stops the server, so it takes no new
 * requests and lets the ones in flight finish, and then exits with code 1 once
 * the logger has flushed. Later calls only keep the failing exit code: the
 * stop is already under way. If the stop itself fails (for example because
 * hapi-pulse began one on SIGTERM), the process still exits with code 1.
 * @param {import('@hapi/hapi').Server} server
 * @returns {() => void}
 */
export function createFatalShutdown(server) {
  let stopping = false
  return () => {
    process.exitCode = 1
    if (stopping) {
      return
    }
    stopping = true
    server
      .stop({ timeout: FATAL_STOP_TIMEOUT_MS })
      .then(exitProcessAfterFlush, exitProcessAfterFlush)
  }
}
