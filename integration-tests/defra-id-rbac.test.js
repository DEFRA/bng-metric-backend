import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404

const ROLE_APPROVED = 3
const ROLE_REMOVED = 6
const ROLE_NAME = 'bng completer'

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

const relString = (relId, orgId, orgName) =>
  `${relId}:${orgId}:${orgName}:0:Employee:1`
const roleString = (relId, status) => `${relId}:${ROLE_NAME}:${status}`

function sessionClaims({
  sub,
  relId,
  orgId = 'org-1',
  orgName = 'Acme Ltd',
  status = ROLE_APPROVED
}) {
  return {
    sub,
    email: `${sub}@example.test`,
    firstName: 'Test',
    lastName: 'User',
    currentRelationshipId: relId,
    relationships: [relString(relId, orgId, orgName)],
    roles: [roleString(relId, status)]
  }
}

async function postSession(token) {
  return server.inject({
    method: 'POST',
    url: '/auth/session',
    headers: authHeaders(token)
  })
}

async function createProject(token, name) {
  const res = await server.inject({
    method: 'POST',
    url: '/projects/new',
    headers: authHeaders(token),
    payload: { project: { name } }
  })
  expect(res.statusCode).toBe(HTTP_OK)
  return res.result
}

describe('POST /auth/session', () => {
  it('persists one user row, N relationships and M roles', async () => {
    const sub = `it-${randomUUID()}`
    const claims = {
      sub,
      email: 'a@b.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      relationships: [
        relString('rel-1', 'org-1', 'Acme Ltd'),
        relString('rel-2', 'org-2', 'Globex')
      ],
      roles: [roleString('rel-1', ROLE_APPROVED), roleString('rel-2', 1)]
    }

    const res = await postSession(await mintToken(claims))
    expect(res.statusCode).toBe(HTTP_NO_CONTENT)

    const users = await dbClient.query(
      'SELECT * FROM bng.users WHERE user_id = $1',
      [sub]
    )
    expect(users.rows).toHaveLength(1)
    expect(users.rows[0].email).toBe('a@b.test')
    expect(users.rows[0].last_login).not.toBeNull()

    const rels = await dbClient.query(
      'SELECT * FROM bng.relationships WHERE user_id = $1 ORDER BY relationship_id',
      [sub]
    )
    expect(rels.rows.map((r) => r.relationship_id)).toEqual(['rel-1', 'rel-2'])

    const roles = await dbClient.query(
      'SELECT * FROM bng.roles WHERE user_id = $1',
      [sub]
    )
    expect(roles.rows).toHaveLength(2)
  })

  it('upserts on a second login (no dupes; status + last_login refreshed)', async () => {
    const sub = `it-${randomUUID()}`
    await postSession(
      await mintToken(sessionClaims({ sub, relId: 'rel-1', status: 1 }))
    )
    await postSession(
      await mintToken(
        sessionClaims({ sub, relId: 'rel-1', status: ROLE_APPROVED })
      )
    )

    const rels = await dbClient.query(
      'SELECT * FROM bng.relationships WHERE user_id = $1',
      [sub]
    )
    expect(rels.rows).toHaveLength(1)

    const roles = await dbClient.query(
      'SELECT status FROM bng.roles WHERE user_id = $1',
      [sub]
    )
    expect(roles.rows).toHaveLength(1)
    expect(roles.rows[0].status).toBe(ROLE_APPROVED)
  })

  it('returns 401 without a bearer token', async () => {
    const res = await server.inject({ method: 'POST', url: '/auth/session' })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})

describe('createProject stamps org context from the token', () => {
  it('stores org_id and relationship_id from the current relationship', async () => {
    const sub = `it-${randomUUID()}`
    const token = await mintToken(
      sessionClaims({
        sub,
        relId: 'rel-9',
        orgId: 'org-9',
        orgName: 'Stark Industries'
      })
    )
    const created = await createProject(token, 'Stamped Project')

    const row = await dbClient.query(
      'SELECT org_id, relationship_id, user_id FROM bng.projects WHERE id = $1',
      [created.id]
    )
    expect(row.rows[0]).toEqual({
      org_id: 'org-9',
      relationship_id: 'rel-9',
      user_id: sub
    })
  })
})

describe('RBAC visibility', () => {
  it('shows a project under an approved (3) relationship, then hides it when the role flips to 6', async () => {
    const sub = `it-${randomUUID()}`
    const relId = 'rel-rbac'

    // Approved login + project under that relationship.
    await postSession(
      await mintToken(sessionClaims({ sub, relId, status: ROLE_APPROVED }))
    )
    const approvedToken = await mintToken(
      sessionClaims({ sub, relId, status: ROLE_APPROVED })
    )
    const created = await createProject(approvedToken, 'RBAC Project')

    const visible = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}`,
      headers: authHeaders(approvedToken)
    })
    expect(visible.statusCode).toBe(HTTP_OK)

    const listVisible = await server.inject({
      method: 'GET',
      url: `/users/${sub}/projects`,
      headers: authHeaders(approvedToken)
    })
    expect(listVisible.result).toHaveLength(1)

    // Access removed at the IdP arrives as a status update (6).
    await postSession(
      await mintToken(sessionClaims({ sub, relId, status: ROLE_REMOVED }))
    )
    const removedToken = await mintToken(
      sessionClaims({ sub, relId, status: ROLE_REMOVED })
    )

    const hidden = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}`,
      headers: authHeaders(removedToken)
    })
    expect(hidden.statusCode).toBe(HTTP_NOT_FOUND)

    const listHidden = await server.inject({
      method: 'GET',
      url: `/users/${sub}/projects`,
      headers: authHeaders(removedToken)
    })
    expect(listHidden.result).toEqual([])
  })

  it('keeps a legacy null-relationship project visible to its owner regardless of roles', async () => {
    const sub = `it-${randomUUID()}`
    // No current relationship → relationship_id stays null.
    const token = await mintToken({ sub })
    const created = await createProject(token, 'Legacy Project')

    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}`,
      headers: authHeaders(token)
    })
    expect(res.statusCode).toBe(HTTP_OK)
  })

  it('does not leak other users’ projects from GET /projects', async () => {
    const owner = `it-${randomUUID()}`
    const ownerToken = await mintToken({ sub: owner })
    await createProject(ownerToken, "Owner's project")

    const other = `it-${randomUUID()}`
    const otherToken = await mintToken({ sub: other })
    const res = await server.inject({
      method: 'GET',
      url: '/projects',
      headers: authHeaders(otherToken)
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual([])
  })
})
