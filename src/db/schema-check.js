import { metricsCounter } from '../common/helpers/metrics.js'
import { DATABASE_METRIC } from '../common/helpers/metric-names.js'
import {
  SCHEMA_OUT_OF_DATE_PREFIX,
  describeError,
  isSchemaMissingError
} from './describe-database-error.js'

/**
 * The newest Liquibase changeset this code needs: the last one in
 * changelog/db.changelog.xml. A test fails when a changeset is added without
 * moving this on, so it cannot fall behind the changelog.
 *
 * The changelog is published and run separately from the image (Publish DB
 * Schema, then the CDP Portal), so a deploy can reach an environment before
 * its migrations do. When it does, every query touching the new table fails
 * and every other query works, which reads as a service that is mostly up.
 */
const REQUIRED_CHANGESET = Object.freeze({
  id: '41',
  author: 'bng-team',
  file: 'db.changelog-1.15.xml'
})

/**
 * Check at startup that the database has the changeset the code needs, and
 * say so loudly if it does not. Only ever logs: the service still starts,
 * because everything that does not touch the missing schema still works.
 *
 * @param {{ query: Function }} pool
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {Promise<'current' | 'out-of-date' | 'unknown'>}
 */
async function checkSchemaIsCurrent(pool, logger) {
  const { id, author, file } = REQUIRED_CHANGESET
  let applied
  try {
    // Unqualified, as Liquibase creates it: in the connection's default schema.
    const result = await pool.query(
      'SELECT 1 FROM databasechangelog WHERE id = $1 AND author = $2 LIMIT 1',
      [id, author]
    )
    applied = result.rows.length > 0
  } catch (error) {
    logger.warn(
      `Database schema check skipped - could not read databasechangelog: ${describeError(error)}`
    )
    return 'unknown'
  }

  if (applied) {
    logger.info(
      `Database schema is current - changeset ${id} (${file}) is applied`
    )
    return 'current'
  }

  logger.error(
    `${SCHEMA_OUT_OF_DATE_PREFIX} - changeset ${id} (${file}) has not been applied to this database. Run the database migration for this environment in the CDP Portal (after the Publish DB Schema workflow); until then every query that needs it fails with a 500.`
  )
  await metricsCounter(DATABASE_METRIC.schemaOutOfDate, 1, {
    source: 'startup'
  })
  return 'out-of-date'
}

/**
 * Log a request that failed because the database is missing a table or
 * column, on any route, where hapi's own error log would show only the
 * wrapping `Failed query: …` and not the Postgres error that explains it.
 *
 * @param {{ info: Function, error: Function }} logger
 * @returns {(request: object, event: { error?: unknown }) => Promise<void>}
 */
function schemaErrorListener(logger) {
  return async (request, event) => {
    if (!isSchemaMissingError(event?.error)) {
      return
    }
    logger.error(
      `${request.method?.toUpperCase()} ${request.path} failed: ${describeError(event.error)}`
    )
    await metricsCounter(DATABASE_METRIC.schemaOutOfDate, 1, {
      source: 'request'
    })
  }
}

export { REQUIRED_CHANGESET, checkSchemaIsCurrent, schemaErrorListener }
