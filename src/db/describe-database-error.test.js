import { describe, expect, it } from 'vitest'

import {
  describeError,
  findPostgresError,
  isSchemaMissingError,
  loggableError
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

describe('#describeError', () => {
  it('says the schema is out of date, and why, for a missing table', () => {
    expect(describeError(drizzleError(MISSING_TABLE))).toBe(
      'DATABASE SCHEMA OUT OF DATE (has a database migration not been run in this environment?): DrizzleQueryError: Failed query: delete from "bng"."baseline_vertical_habitats" where "bng"."baseline_vertical_habitats"."project_id" = $1 params: 043b45e6-096e-4c72-925e-ca5f1efdd0d9 — caused by Postgres 42P01: relation "bng.baseline_vertical_habitats" does not exist'
    )
  })

  it('gives the Postgres error behind any other failed query', () => {
    expect(
      describeError(drizzleError(postgresError('23505', 'duplicate key value')))
    ).toMatch(
      /^DrizzleQueryError: .* — caused by Postgres 23505: duplicate key value$/
    )
  })

  it('gives the code of a Postgres error thrown directly', () => {
    expect(describeError(MISSING_TABLE)).toMatch(
      /^DATABASE SCHEMA OUT OF DATE .*: error: relation .* does not exist \(Postgres 42P01\)$/
    )
  })

  it('gives the type and message of any other error', () => {
    expect(describeError(new TypeError('nope'))).toBe('TypeError: nope')
  })

  it("caps a long message, such as an insert's parameters", () => {
    const described = describeError(new Error('x'.repeat(5000)))
    expect(described).toBe(`Error: ${'x'.repeat(500)}…`)
  })

  it('leaves the alarm out when asked to, for a missing table that is no sign of a migration', () => {
    expect(describeError(MISSING_TABLE, { flagSchemaMissing: false })).toMatch(
      /^error: relation .* does not exist \(Postgres 42P01\)$/
    )
  })
})

describe('#loggableError', () => {
  // The ECS formatter writes an Error's message and stack in full, and the
  // stack opens with the message: a failed insert's geometry, twice.
  it('caps the message, in the stack too, and keeps the frames', () => {
    const huge = drizzleError(MISSING_TABLE)
    huge.message = `Failed query: insert params: ${'x'.repeat(5000)}`
    huge.stack = `DrizzleQueryError: ${huge.message}\n    at save (save.js:1:1)\n    at run (run.js:2:2)`

    const logged = loggableError(huge)

    expect(logged.message).toHaveLength(501)
    expect(logged.stack).toBe(
      `DrizzleQueryError: ${logged.message}\n    at save (save.js:1:1)\n    at run (run.js:2:2)`
    )
    expect(logged.stack.length).toBeLessThan(600)
  })

  it('keeps the error type, for ECS to name', () => {
    const logged = loggableError(new TypeError('nope'))

    expect(logged).toBeInstanceOf(TypeError)
    expect(logged.constructor.name).toBe('TypeError')
    expect(logged.name).toBe('TypeError')
    expect(logged.message).toBe('nope')
  })

  // pino takes a string first argument as the message, which would drop the
  // log line's own text.
  it('wraps a value that is not an Error', () => {
    const logged = loggableError('worker exited')

    expect(logged).toBeInstanceOf(Error)
    expect(logged.message).toBe('worker exited')
  })
})
