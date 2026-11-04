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
