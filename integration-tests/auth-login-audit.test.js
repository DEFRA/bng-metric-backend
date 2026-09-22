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
// token, and the append is de-duplicated on session ID plus active relationship.
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
  it.each([undefined, null, '', '   '])(
    'deduplicates a known session with relationship %j',
    async (currentRelationshipId) => {
      const sub = `it-${randomUUID()}`
      const token = await mintToken({
        sub,
        sessionId: 'no-relationship',
        currentRelationshipId
      })
      expect((await postSession(token)).statusCode).toBe(HTTP_NO_CONTENT)
      expect((await postSession(token)).statusCode).toBe(HTTP_NO_CONTENT)
      const { rows } = await loginRows(sub)
      expect(rows).toHaveLength(1)
      expect(rows[0].current_relationship_id).toBeNull()
    }
  )

  it('deduplicates case and whitespace variants and matches the user relationship', async () => {
    const sub = `it-${randomUUID()}`
    for (const currentRelationshipId of [' REL-A ', 'rel-a', 'Rel-A']) {
      expect(
        (
          await postSession(
            await mintToken({
              sub,
              sessionId: 'canonical-session',
              currentRelationshipId
            })
          )
        ).statusCode
      ).toBe(HTTP_NO_CONTENT)
    }
    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(1)
    expect(rows[0].current_relationship_id).toBe('rel-a')
    const users = await dbClient.query(
      'SELECT current_relationship_id FROM bng.users WHERE user_id = $1',
      [sub]
    )
    expect(users.rows[0].current_relationship_id).toBe(
      rows[0].current_relationship_id
    )
  })

  it('records a relationship selected after a login with none, while suppressing retries', async () => {
    const sub = `it-${randomUUID()}`
    for (const currentRelationshipId of [null, 'rel-a', null, 'REL-A']) {
      expect(
        (
          await postSession(
            await mintToken({
              sub,
              sessionId: 'relationship-selected',
              currentRelationshipId
            })
          )
        ).statusCode
      ).toBe(HTTP_NO_CONTENT)
    }
    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.current_relationship_id)).toEqual(
      expect.arrayContaining([null, 'rel-a'])
    )
  })

  it.each([undefined, 'rel-a'])(
    'always records logins without a session, with relationship %j',
    async (currentRelationshipId) => {
      const sub = `it-${randomUUID()}`
      const token = await mintToken({ sub, currentRelationshipId })
      expect((await postSession(token)).statusCode).toBe(HTTP_NO_CONTENT)
      expect((await postSession(token)).statusCode).toBe(HTTP_NO_CONTENT)
      expect((await loginRows(sub)).rows).toHaveLength(2)
    }
  )
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

  it('is a graceful no-op for a repeat login with the same session and relationship (no duplicate, still 204)', async () => {
    const sub = `it-${randomUUID()}`
    const claims = {
      sub,
      email: 'grace@example.test',
      sessionId: 'sess-dup',
      currentRelationshipId: 'rel-dup'
    }

    const first = await postSession(await mintToken(claims))
    const second = await postSession(await mintToken(claims))

    expect(first.statusCode).toBe(HTTP_NO_CONTENT)
    // A repeat call for an already-recorded session is not an error.
    expect(second.statusCode).toBe(HTTP_NO_CONTENT)

    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(1)
    expect(rows[0].session_id).toBe('sess-dup')
  })

  it('records one login for each browser signed in under different organisations', async () => {
    const sub = `it-${randomUUID()}`
    await postSession(
      await mintToken({
        sub,
        sessionId: 'browser-1-session',
        currentRelationshipId: 'rel-org-a'
      })
    )
    await postSession(
      await mintToken({
        sub,
        sessionId: 'browser-2-session',
        currentRelationshipId: 'rel-org-b'
      })
    )

    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.session_id)).toEqual([
      'browser-1-session',
      'browser-2-session'
    ])
    expect(rows.map((row) => row.current_relationship_id)).toEqual([
      'rel-org-a',
      'rel-org-b'
    ])
  })

  it('records an organisation switch in the same browser as a distinct login', async () => {
    const sub = `it-${randomUUID()}`
    const sessionId = 'shared-browser-session'

    await postSession(
      await mintToken({ sub, sessionId, currentRelationshipId: 'rel-org-a' })
    )
    await postSession(
      await mintToken({ sub, sessionId, currentRelationshipId: 'rel-org-b' })
    )

    const { rows } = await loginRows(sub)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.current_relationship_id).sort()).toEqual([
      'rel-org-a',
      'rel-org-b'
    ])
    expect(rows.map((row) => row.session_id)).toEqual([sessionId, sessionId])
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
