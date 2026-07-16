import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_NO_CONTENT = 204
const HTTP_UNAUTHORIZED = 401

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

async function postLoginAudit(token) {
  return server.inject({
    method: 'POST',
    url: '/auth/login-audit',
    headers: authHeaders(token)
  })
}

function loginRows(sub) {
  return dbClient.query(
    'SELECT * FROM bng.login_audit WHERE user_id = $1 ORDER BY logged_in_at',
    [sub]
  )
}

describe('POST /auth/login-audit', () => {
  it('appends one immutable login-audit row from the verified token claims', async () => {
    const sub = `it-${randomUUID()}`
    const claims = {
      sub,
      email: 'ada@example.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      sessionId: 'sess-abc'
    }

    const res = await postLoginAudit(await mintToken(claims))
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

  it('appends a new row on each login (append-only, never upserted)', async () => {
    const sub = `it-${randomUUID()}`
    const claims = { sub, email: 'grace@example.test', sessionId: 'sess-1' }

    await postLoginAudit(await mintToken(claims))
    await postLoginAudit(await mintToken({ ...claims, sessionId: 'sess-2' }))

    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.session_id).sort()).toEqual(['sess-1', 'sess-2'])
  })

  it('returns 401 without a bearer token and records nothing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/login-audit'
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})
