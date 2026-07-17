import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_NO_CONTENT = 204

let server
let dbClient

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  await truncateTestData(dbClient)
})

afterEach(async () => {
  await truncateTestData(dbClient)
})

afterAll(async () => {
  await dbClient.end()
  await stopServer(server)
})

// The login is recorded as a side effect of the POST /auth/session workflow —
// there is no dedicated audit endpoint. Identity comes solely from the verified
// token, and the append is de-duplicated on session_id.
async function postSession(token) {
  return server.inject({
    method: 'POST',
    url: '/auth/session',
    headers: authHeaders(token)
  })
}

function loginRows(sub) {
  return dbClient.query(
    'SELECT * FROM bng.login_audit WHERE user_id = $1 ORDER BY session_id',
    [sub]
  )
}

describe('login audit via POST /auth/session', () => {
  it('appends one immutable login-audit row from the verified token claims', async () => {
    const sub = `it-${randomUUID()}`
    const res = await postSession(
      await mintToken({
        sub,
        email: 'ada@example.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
        currentRelationshipId: 'rel-1',
        sessionId: 'sess-abc'
      })
    )
    expect(res.statusCode).toBe(HTTP_NO_CONTENT)

    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      user_id: sub,
      email: 'ada@example.test',
      first_name: 'Ada',
      last_name: 'Lovelace',
      current_relationship_id: 'rel-1',
      session_id: 'sess-abc'
    })
    // Server-set UTC timestamp.
    expect(rows[0].logged_in_at).toBeInstanceOf(Date)
  })

  it('is a graceful no-op for a repeat login with the same session id (no duplicate, still 204)', async () => {
    const sub = `it-${randomUUID()}`
    const claims = { sub, email: 'grace@example.test', sessionId: 'sess-dup' }

    const first = await postSession(await mintToken(claims))
    const second = await postSession(await mintToken(claims))

    expect(first.statusCode).toBe(HTTP_NO_CONTENT)
    // A repeat call for an already-recorded session is not an error.
    expect(second.statusCode).toBe(HTTP_NO_CONTENT)

    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(1)
    expect(rows[0].session_id).toBe('sess-dup')
  })

  it('records a new row for each distinct session of the same user', async () => {
    const sub = `it-${randomUUID()}`
    await postSession(await mintToken({ sub, sessionId: 'sess-1' }))
    await postSession(await mintToken({ sub, sessionId: 'sess-2' }))

    const { rows } = await loginRows(sub)
    expect(rows.map((r) => r.session_id)).toEqual(['sess-1', 'sess-2'])
  })

  it('still records a login when the token carries no session id (null session_id)', async () => {
    const sub = `it-${randomUUID()}`
    const res = await postSession(await mintToken({ sub, email: 'x@y.test' }))
    expect(res.statusCode).toBe(HTTP_NO_CONTENT)

    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(1)
    expect(rows[0].session_id).toBeNull()
  })
})
