import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { metricsCounter } from '../common/helpers/metrics.js'
import {
  REQUIRED_CHANGESET,
  checkSchemaIsCurrent,
  recordSchemaError,
  schemaErrorListener
} from './schema-check.js'

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn()
}))

const CHANGELOG_DIR = resolve(import.meta.dirname, '..', '..', 'changelog')

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function poolAnswering(rows) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

/** An XML tag's attribute, or undefined. */
function attribute(tag, name) {
  return new RegExp(String.raw`\b${name}="([^"]*)"`).exec(tag)?.[1]
}

/**
 * Whether a Liquibase tag is limited to some environments. Production runs
 * with no context, so a changeset or include with one may never reach it.
 */
function isContextual(tag) {
  return (
    attribute(tag, 'context') !== undefined ||
    attribute(tag, 'contextFilter') !== undefined
  )
}

/** The last changeset in the changelog that runs in every environment. */
function lastChangeset() {
  const master = readFileSync(
    resolve(CHANGELOG_DIR, 'db.changelog.xml'),
    'utf8'
  )
  const files = [...master.matchAll(/<include\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => !isContextual(tag))
    .map((tag) => attribute(tag, 'file'))

  for (const file of files.reverse()) {
    const changelog = readFileSync(resolve(CHANGELOG_DIR, file), 'utf8')
    const tag = [...changelog.matchAll(/<changeSet\b[^>]*>/g)]
      .map(([changeSet]) => changeSet)
      .findLast((changeSet) => !isContextual(changeSet))
    if (tag) {
      return {
        id: attribute(tag, 'id'),
        author: attribute(tag, 'author'),
        file
      }
    }
  }
  return null
}

describe('REQUIRED_CHANGESET', () => {
  // A new changeset has to move this on, or the startup check would pass
  // against a database that does not have it.
  // A changeset limited to some contexts, such as test data, may never run in
  // production, so naming one would raise the alarm on every startup there.
  it('is the last changeset in the changelog that runs in every environment', () => {
    expect(REQUIRED_CHANGESET).toEqual(lastChangeset())
  })
})

describe('#checkSchemaIsCurrent', () => {
  beforeEach(() => {
    vi.mocked(metricsCounter).mockClear()
  })

  it('asks Liquibase for the required changeset', async () => {
    const pool = poolAnswering([{}])

    await checkSchemaIsCurrent(pool, makeLogger())

    expect(pool.query).toHaveBeenCalledWith(
      'SELECT 1 FROM databasechangelog WHERE id = $1 AND author = $2 LIMIT 1',
      [REQUIRED_CHANGESET.id, REQUIRED_CHANGESET.author]
    )
  })

  it('says so when the changeset is applied', async () => {
    const logger = makeLogger()

    await expect(
      checkSchemaIsCurrent(poolAnswering([{}]), logger)
    ).resolves.toBe('current')

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Database schema is current')
    )
    expect(logger.error).not.toHaveBeenCalled()
    expect(metricsCounter).not.toHaveBeenCalled()
  })

  it('logs loudly and counts it when the changeset is missing', async () => {
    const logger = makeLogger()

    await expect(checkSchemaIsCurrent(poolAnswering([]), logger)).resolves.toBe(
      'out-of-date'
    )

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^DATABASE SCHEMA OUT OF DATE - changeset ${REQUIRED_CHANGESET.id} \\(${REQUIRED_CHANGESET.file}\\) has not been applied`
        )
      )
    )
    expect(metricsCounter).toHaveBeenCalledWith('DatabaseSchemaOutOfDate', 1, {
      source: 'startup'
    })
  })

  // An environment where the service cannot read Liquibase's table is not
  // evidence of a missing migration, so it must not raise the alarm.
  it('warns, and does not raise the alarm, when it cannot check', async () => {
    const logger = makeLogger()
    const denied = new Error('permission denied for table databasechangelog')
    denied.code = '42501'
    const pool = { query: vi.fn().mockRejectedValue(denied) }

    await expect(checkSchemaIsCurrent(pool, logger)).resolves.toBe('unknown')

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Database schema check skipped')
    )
    expect(logger.error).not.toHaveBeenCalled()
    expect(metricsCounter).not.toHaveBeenCalled()
  })

  // A fresh database, or Liquibase writing to a schema off the app user's
  // search_path, has no databasechangelog to read: still nothing known.
  it('does not raise the alarm when there is no databasechangelog to read', async () => {
    const logger = makeLogger()
    const absent = new Error('relation "databasechangelog" does not exist')
    absent.code = '42P01'
    const pool = { query: vi.fn().mockRejectedValue(absent) }

    await expect(checkSchemaIsCurrent(pool, logger)).resolves.toBe('unknown')

    expect(logger.warn).toHaveBeenCalledWith(
      'Database schema check skipped - could not read databasechangelog: Error: relation "databasechangelog" does not exist (Postgres 42P01)'
    )
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('DATABASE SCHEMA OUT OF DATE')
    )
    expect(logger.error).not.toHaveBeenCalled()
    expect(metricsCounter).not.toHaveBeenCalled()
  })
})

describe('#recordSchemaError', () => {
  beforeEach(() => {
    vi.mocked(metricsCounter).mockClear()
  })

  it('counts a query that failed on a missing column', async () => {
    const missing = new Error('column "x" does not exist')
    missing.code = '42703'

    await expect(recordSchemaError(missing)).resolves.toBe(true)

    expect(metricsCounter).toHaveBeenCalledWith('DatabaseSchemaOutOfDate', 1, {
      source: 'request'
    })
  })

  it('counts nothing for any other error', async () => {
    await expect(recordSchemaError(new Error('boom'))).resolves.toBe(false)
    await expect(recordSchemaError(undefined)).resolves.toBe(false)

    expect(metricsCounter).not.toHaveBeenCalled()
  })
})

describe('#schemaErrorListener', () => {
  beforeEach(() => {
    vi.mocked(metricsCounter).mockClear()
  })

  const request = { method: 'get', path: '/projects/p1' }

  it('logs and counts a request that failed on a missing table', async () => {
    const logger = makeLogger()
    const missing = new Error('relation "bng.x" does not exist')
    missing.code = '42P01'
    const failed = new Error('Failed query: select 1')
    failed.name = 'DrizzleQueryError'
    failed.cause = missing

    await schemaErrorListener(logger)(request, { error: failed })

    expect(logger.error).toHaveBeenCalledWith(
      'GET /projects/p1 failed: DATABASE SCHEMA OUT OF DATE (has a database migration not been run in this environment?): DrizzleQueryError: Failed query: select 1 — caused by Postgres 42P01: relation "bng.x" does not exist'
    )
    expect(metricsCounter).toHaveBeenCalledWith('DatabaseSchemaOutOfDate', 1, {
      source: 'request'
    })
  })

  it('leaves every other error to the request log', async () => {
    const logger = makeLogger()

    await schemaErrorListener(logger)(request, { error: new Error('boom') })
    await schemaErrorListener(logger)(request, {})

    expect(logger.error).not.toHaveBeenCalled()
    expect(metricsCounter).not.toHaveBeenCalled()
  })
})
