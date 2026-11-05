import { DrizzleQueryError } from 'drizzle-orm'

import { PG_LOCK_NOT_AVAILABLE } from '../../src/db/postgres-error-codes.js'

/**
 * The lock timeout a query run through Drizzle rejects with: Drizzle wraps
 * the driver's error in its own DrizzleQueryError, and the SQLSTATE stays on
 * the driver's error, in `cause`. The wrapper has no `code` of its own.
 *
 * @param {string} [query] the statement that timed out
 * @returns {DrizzleQueryError}
 */
function drizzleLockTimeout(
  query = 'select "id" from "bng"."projects" for update'
) {
  const pgError = Object.assign(
    new Error('canceling statement due to lock timeout'),
    { code: PG_LOCK_NOT_AVAILABLE, severity: 'ERROR' }
  )
  return new DrizzleQueryError(query, [], pgError)
}

export { drizzleLockTimeout }
