import {
  describeError,
  shorten
} from '../common/helpers/logging/describe-error.js'
import {
  PG_UNDEFINED_COLUMN,
  PG_UNDEFINED_TABLE
} from './postgres-error-codes.js'

/**
 * The Postgres errors that mean the database is missing something the code
 * expects: a table or a column a migration adds. Seen when the code is
 * deployed to an environment whose migrations have not been run — every query
 * touching the new table fails, while every other query works.
 */
const SCHEMA_MISSING_CODES = new Set([PG_UNDEFINED_TABLE, PG_UNDEFINED_COLUMN])

/**
 * A SQLSTATE: five digits or capital letters, at least one a digit. Every
 * Postgres code has one (42P01, XX000, P0001, HV00A); a Node system error's
 * code, such as EPIPE or EPERM, is all letters and would otherwise match.
 */
const SQLSTATE_PATTERN = /^(?=[A-Z]*\d)[0-9A-Z]{5}$/

/** How far down an error's `cause` chain to look for the Postgres error. */
const MAX_CAUSE_DEPTH = 5

export const SCHEMA_OUT_OF_DATE_PREFIX = 'DATABASE SCHEMA OUT OF DATE'

/**
 * The Postgres error behind an error, or null. Drizzle wraps the driver's
 * error in its own `Failed query: …`, whose message says which query failed
 * but not why: the why — `relation "…" does not exist` and its SQLSTATE — is
 * on the driver's error, in `cause`.
 *
 * @param {unknown} error
 * @returns {(Error & { code: string }) | null} the error itself, or one in its
 *   `cause` chain
 */
function findPostgresError(error) {
  let current = error
  for (let depth = 0; current && depth <= MAX_CAUSE_DEPTH; depth++) {
    if (
      typeof current.code === 'string' &&
      SQLSTATE_PATTERN.test(current.code)
    ) {
      return current
    }
    current = current.cause
  }
  return null
}

/**
 * Whether an error says the database is missing a table or column the code
 * expects — the usual sign of a migration that has not been run.
 *
 * @param {unknown} error
 */
function isSchemaMissingError(error) {
  return SCHEMA_MISSING_CODES.has(findPostgresError(error)?.code)
}

/**
 * An error, for a log line, as {@link describeError} gives it, with the
 * Postgres error behind it when there is one, and a prefix no one can miss
 * when that Postgres error says a table or column is missing — unless
 * `flagSchemaMissing` is false, for a caller to whom a missing table is not
 * evidence of a missing migration.
 *
 * @param {unknown} error
 * @param {{ flagSchemaMissing?: boolean }} [options]
 * @returns {string}
 */
function describeDatabaseError(error, { flagSchemaMissing = true } = {}) {
  const own = describeError(error)
  const postgres = findPostgresError(error)
  if (!postgres) {
    return own
  }
  const cause =
    postgres === error
      ? `${own} (Postgres ${postgres.code})`
      : `${own} — caused by Postgres ${postgres.code}: ${shorten(postgres.message)}`
  if (!flagSchemaMissing || !SCHEMA_MISSING_CODES.has(postgres.code)) {
    return cause
  }
  return `${SCHEMA_OUT_OF_DATE_PREFIX} (has a database migration not been run in this environment?): ${cause}`
}

export { describeDatabaseError, findPostgresError, isSchemaMissingError }
