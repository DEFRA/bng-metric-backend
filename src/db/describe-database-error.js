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

/** A SQLSTATE: five digits or capital letters. */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/

/** How far down an error's `cause` chain to look for the Postgres error. */
const MAX_CAUSE_DEPTH = 5

/**
 * Longest stretch of an error message worth logging. Drizzle's message is the
 * whole failed query followed by its parameters, and an insert's parameters
 * carry every feature's geometry.
 */
const MAX_MESSAGE_LENGTH = 500

export const SCHEMA_OUT_OF_DATE_PREFIX = 'DATABASE SCHEMA OUT OF DATE'

/**
 * The Postgres error behind an error, or null. Drizzle wraps the driver's
 * error in its own `Failed query: …`, whose message says which query failed
 * but not why: the why — `relation "…" does not exist` and its SQLSTATE — is
 * on the driver's error, in `cause`.
 *
 * @param {unknown} error
 * @returns {{ code: string, message: string } | null}
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

function shorten(message) {
  const text = String(message ?? '').replaceAll(/\s+/g, ' ')
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…`
    : text
}

/**
 * An error, for a log line: its type and message, the Postgres error behind
 * it when there is one, and a prefix no one can miss when that Postgres error
 * says a table or column is missing — unless `flagSchemaMissing` is false,
 * for a caller to whom a missing table is not evidence of a missing migration.
 *
 * @param {unknown} error
 * @param {{ flagSchemaMissing?: boolean }} [options]
 * @returns {string}
 */
function describeError(error, { flagSchemaMissing = true } = {}) {
  const own = `${error?.name}: ${shorten(error?.message)}`
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

/** A stack trace's frames, without the `Name: message` header above them. */
function stackFrames(stack) {
  const lines = String(stack ?? '').split('\n')
  const firstFrame = lines.findIndex((line) => /^\s+at /.test(line))
  return firstFrame === -1 ? [] : lines.slice(firstFrame)
}

/**
 * An error for the logger's error fields, its message capped as
 * {@link describeError} caps it. The ECS formatter writes an Error's message
 * and stack in full, and a stack opens with the message, so logging a failed
 * insert itself would write every feature's geometry into the line twice.
 * The copy keeps the error's type and its stack's frames. A value that is
 * not an Error is wrapped in one, so it cannot take the log line's message.
 *
 * @param {unknown} error
 * @returns {Error}
 */
function loggableError(error) {
  if (!(error instanceof Error)) {
    return new Error(shorten(error))
  }
  const copy = Object.create(Object.getPrototypeOf(error))
  const message = shorten(error.message)
  const header = `${error.name}: ${message}`
  Object.defineProperties(copy, {
    name: { value: error.name, writable: true, configurable: true },
    message: { value: message, writable: true, configurable: true },
    stack: {
      value: [header, ...stackFrames(error.stack)].join('\n'),
      writable: true,
      configurable: true
    }
  })
  return copy
}

export { describeError, findPostgresError, isSchemaMissingError, loggableError }
