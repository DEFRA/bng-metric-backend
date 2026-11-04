import { describe, expect, it } from 'vitest'

import {
  describeDatabaseError,
  findPostgresError,
  isSchemaMissingError
} from './describe-database-error.js'

// The shape node-postgres rejects with, and the one Drizzle wraps it in.
function postgresError(code, message) {
  const error = new Error(message)
  error.name = 'error'
  error.code = code
  error.severity = 'ERROR'
  return error
}

function drizzleError(cause) {
  const error = new Error(
    'Failed query: delete from "bng"."baseline_vertical_habitats" where "bng"."baseline_vertical_habitats"."project_id" = $1\nparams: 043b45e6-096e-4c72-925e-ca5f1efdd0d9'
  )
  error.name = 'DrizzleQueryError'
  error.cause = cause
  return error
}

const MISSING_TABLE = postgresError(
  '42P01',
  'relation "bng.baseline_vertical_habitats" does not exist'
)

describe('#findPostgresError', () => {
  it('finds the Postgres error behind a failed Drizzle query', () => {
    expect(findPostgresError(drizzleError(MISSING_TABLE))).toBe(MISSING_TABLE)
  })

  it('finds a Postgres error thrown directly', () => {
    expect(findPostgresError(MISSING_TABLE)).toBe(MISSING_TABLE)
  })

  it('finds nothing in an error that is not from Postgres', () => {
    const socket = new Error('read ECONNRESET')
    socket.code = 'ECONNRESET'
    expect(findPostgresError(socket)).toBeNull()
    expect(findPostgresError(new TypeError('nope'))).toBeNull()
    expect(findPostgresError(undefined)).toBeNull()
  })

  it('takes a Node system error, whose code looks like a SQLSTATE, for what it is', () => {
    for (const code of ['EPIPE', 'EPERM', 'EBUSY']) {
      const system = new Error(`write ${code}`)
      system.code = code
      expect(findPostgresError(drizzleError(system))).toBeNull()
    }
  })

  it('finds a SQLSTATE of any class', () => {
    for (const code of ['XX000', 'P0001', 'HV00A', '22P02']) {
      const error = postgresError(code, 'failed')
      expect(findPostgresError(error)).toBe(error)
    }
  })
})

describe('#isSchemaMissingError', () => {
  it('is true for a missing table or column', () => {
    expect(isSchemaMissingError(drizzleError(MISSING_TABLE))).toBe(true)
    expect(
      isSchemaMissingError(
        postgresError('42703', 'column "ref" does not exist')
      )
    ).toBe(true)
  })

  it('is false for any other Postgres error', () => {
    expect(
      isSchemaMissingError(
        drizzleError(postgresError('23505', 'duplicate key value'))
      )
    ).toBe(false)
  })
})

describe('#describeDatabaseError', () => {
  it('does not send a Node system error to the database', () => {
    const system = new Error('write EPIPE')
    system.code = 'EPIPE'
    expect(describeDatabaseError(system)).toBe('Error: write EPIPE')
  })

  it('says the schema is out of date, and why, for a missing table', () => {
    expect(describeDatabaseError(drizzleError(MISSING_TABLE))).toBe(
      'DATABASE SCHEMA OUT OF DATE (has a database migration not been run in this environment?): DrizzleQueryError: Failed query: delete from "bng"."baseline_vertical_habitats" where "bng"."baseline_vertical_habitats"."project_id" = $1 params: 043b45e6-096e-4c72-925e-ca5f1efdd0d9 — caused by Postgres 42P01: relation "bng.baseline_vertical_habitats" does not exist'
    )
  })

  it('gives the Postgres error behind any other failed query', () => {
    expect(
      describeDatabaseError(
        drizzleError(postgresError('23505', 'duplicate key value'))
      )
    ).toMatch(
      /^DrizzleQueryError: .* — caused by Postgres 23505: duplicate key value$/
    )
  })

  it('quotes a thrown value that is not an Error as it is', () => {
    expect(describeDatabaseError('worker exited')).toBe('worker exited')
  })

  it('gives the code of a Postgres error thrown directly', () => {
    expect(describeDatabaseError(MISSING_TABLE)).toMatch(
      /^DATABASE SCHEMA OUT OF DATE .*: error: relation .* does not exist \(Postgres 42P01\)$/
    )
  })

  it('leaves the alarm out when asked to, for a missing table that is no sign of a migration', () => {
    expect(
      describeDatabaseError(MISSING_TABLE, { flagSchemaMissing: false })
    ).toMatch(/^error: relation .* does not exist \(Postgres 42P01\)$/)
  })
})
