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

// The two organisations a multi-org user is linked to.
const REL_ORG_A = 'rel-org-a'
const REL_ORG_B = 'rel-org-b'

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

// A user linked to TWO organisations, holding an approved 'bng completer' role
// in each, currently acting in `current`. This is the shape that exposed
// BMD-890: both roles are approved, so scoping on ownership + "approved for the
// project's relationship" alone let org A's projects through while the user was
// signed in as org B.
function multiOrgClaims({ sub, current }) {
  return {
    sub,
    email: `${sub}@example.test`,
    firstName: 'Multi',
    lastName: 'Org',
    currentRelationshipId: current,
    relationships: [
      relString(REL_ORG_A, 'org-a', 'Acme Ltd'),
      relString(REL_ORG_B, 'org-b', 'Globex')
    ],
    roles: [
      roleString(REL_ORG_A, ROLE_APPROVED),
      roleString(REL_ORG_B, ROLE_APPROVED)
    ]
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

/** Sign in under `current` (persisting the session) and return the token. */
async function signInAs(sub, current) {
  const token = await mintToken(multiOrgClaims({ sub, current }))
  const res = await postSession(token)
  expect(res.statusCode).toBe(HTTP_NO_CONTENT)
  return token
}

async function listProjects(token, url = '/projects') {
  const res = await server.inject({
    method: 'GET',
    url,
    headers: authHeaders(token)
  })
  expect(res.statusCode).toBe(HTTP_OK)
  return res.result
}

const projectNames = (rows) => rows.map((row) => row.project.name).sort()

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

describe('createProject stamps the org context', () => {
  it('stores org_id and relationship_id for the relationship in play', async () => {
    const sub = `it-${randomUUID()}`
    const token = await mintToken(
      sessionClaims({
        sub,
        relId: 'rel-9',
        orgId: 'org-9',
        orgName: 'Stark Industries'
      })
    )
    // Signing in first mirrors the real flow (the frontend posts the session at
    // the OIDC callback) and means the roles rows exist for the RBAC check.
    expect((await postSession(token)).statusCode).toBe(HTTP_NO_CONTENT)

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

  it('hides a project from its own creator once they switch organisation', async () => {
    // The reported BMD-890 defect, end to end: create under org A, switch to
    // org B, and org A's project must be gone — not merely re-labelled.
    const sub = `it-${randomUUID()}`

    const orgAToken = await signInAs(sub, REL_ORG_A)
    const orgAProject = await createProject(orgAToken, 'Org A project')

    const orgBToken = await signInAs(sub, REL_ORG_B)

    expect(await listProjects(orgBToken)).toEqual([])

    const direct = await server.inject({
      method: 'GET',
      url: `/projects/${orgAProject.id}`,
      headers: authHeaders(orgBToken)
    })
    expect(direct.statusCode).toBe(HTTP_NOT_FOUND)
  })

  // BMD-936: the org scope follows the SIGN-IN, not the token. Switching org is
  // an interactive re-sign-in, which re-posts /auth/session and moves
  // bng.users.current_relationship_id — so each org still gets its own list, and
  // switching back restores the other. What no longer happens is a stale token
  // carrying its own org context: the backend reads the persisted one, so a user
  // signed in twice (two browsers, two orgs) sees their most recent sign-in's
  // org in both. That is the deliberate trade for a single, unambiguous source
  // of org context — a token from a refresh_token grant can name the wrong
  // relationship, and acting on it silently switched a user's org mid-session.
  it.each([['/projects'], ['/users/:sub/projects']])(
    'gives each organisation its own project list for the same user (%s)',
    async (path) => {
      const sub = `it-${randomUUID()}`
      const url = path.replace(':sub', sub)

      const orgAToken = await signInAs(sub, REL_ORG_A)
      await createProject(orgAToken, 'Org A project')

      const orgBToken = await signInAs(sub, REL_ORG_B)
      await createProject(orgBToken, 'Org B project')

      expect(projectNames(await listProjects(orgBToken, url))).toEqual([
        'Org B project'
      ])

      // Switching back shows org A's again — the projects are scoped, not lost.
      const backToOrgA = await signInAs(sub, REL_ORG_A)
      expect(projectNames(await listProjects(backToOrgA, url))).toEqual([
        'Org A project'
      ])
    }
  )

  // BMD-936 (revised): the headline reason the org context is taken from the
  // TOKEN and not from bng.users. The database holds ONE current_relationship_id
  // per user, so once a second device signs in as another org, a DB-only scope
  // serves BOTH sessions that second org — the first device silently starts
  // seeing the wrong organisation's projects without anything having changed on
  // it. Note there is deliberately no re-sign-in before the final assertions:
  // each token is used exactly as a live session would still hold it.
  it('keeps concurrent sessions in different orgs apart', async () => {
    const sub = `it-${randomUUID()}`

    const deviceA = await signInAs(sub, REL_ORG_A)
    await createProject(deviceA, 'Org A project')

    // A second device signs in as the other org. bng.users now records org B.
    const deviceB = await signInAs(sub, REL_ORG_B)
    await createProject(deviceB, 'Org B project')

    expect(projectNames(await listProjects(deviceB))).toEqual(['Org B project'])
    // The still-live first session must be unaffected by the second sign-in.
    expect(projectNames(await listProjects(deviceA))).toEqual(['Org A project'])
  })

  it("stamps a new project under the creating session's org, not the last sign-in", async () => {
    const sub = `it-${randomUUID()}`

    const deviceA = await signInAs(sub, REL_ORG_A)
    await signInAs(sub, REL_ORG_B) // another device moves the stored context

    await createProject(deviceA, 'Made on device A')

    // Created under A, so it is visible to A and invisible to B.
    expect(projectNames(await listProjects(deviceA))).toEqual([
      'Made on device A'
    ])
  })

  // Defra ID returns the same relationship GUID in a different CASE on a
  // refresh_token grant than on interactive sign-in. GUIDs are case-insensitive
  // (RFC 4122), so a refreshed session must keep seeing its own projects.
  it('scopes a refreshed token whose relationship id is cased differently', async () => {
    const sub = `it-${randomUUID()}`

    const atSignIn = await signInAs(sub, REL_ORG_A)
    await createProject(atSignIn, 'Org A project')

    // The same session after a silent refresh: same relationship, upper-cased,
    // and never re-posted to /auth/session (a refresh does not re-persist).
    const afterRefresh = await mintToken(
      multiOrgClaims({ sub, current: REL_ORG_A.toUpperCase() })
    )

    expect(projectNames(await listProjects(afterRefresh))).toEqual([
      'Org A project'
    ])
  })

  it('refuses writes to another organisation’s project', async () => {
    const sub = `it-${randomUUID()}`

    const orgAToken = await signInAs(sub, REL_ORG_A)
    const orgAProject = await createProject(orgAToken, 'Org A project')

    const orgBToken = await signInAs(sub, REL_ORG_B)

    const renamed = await server.inject({
      method: 'PATCH',
      url: `/projects/${orgAProject.id}`,
      headers: authHeaders(orgBToken),
      payload: { project: { name: 'Renamed from org B' } }
    })
    expect(renamed.statusCode).toBe(HTTP_NOT_FOUND)

    const details = await server.inject({
      method: 'PATCH',
      url: `/projects/${orgAProject.id}/details`,
      headers: authHeaders(orgBToken),
      payload: { applicant: 'Someone from org B' }
    })
    expect(details.statusCode).toBe(HTTP_NOT_FOUND)

    // …and the row is untouched, so the 404 is a real refusal, not a silent write.
    const row = await dbClient.query(
      "SELECT project->>'name' AS name FROM bng.projects WHERE id = $1",
      [orgAProject.id]
    )
    expect(row.rows[0].name).toBe('Org A project')
  })

  it('stamps the persisted org context on a project created under a blanked token', async () => {
    // The create and read paths must resolve the org context the SAME way. If
    // create stamped null from a blanked refresh token while read fell back to
    // the stored relationship, the new project would be invisible to its own
    // creator the moment it was made.
    const sub = `it-${randomUUID()}`
    await signInAs(sub, REL_ORG_A)

    const blankedToken = await mintToken({
      sub,
      currentRelationshipId: '',
      relationships: [],
      roles: []
    })
    const created = await createProject(blankedToken, 'Made mid-refresh')

    const row = await dbClient.query(
      'SELECT org_id, relationship_id FROM bng.projects WHERE id = $1',
      [created.id]
    )
    expect(row.rows[0]).toEqual({ org_id: 'org-a', relationship_id: REL_ORG_A })

    expect(projectNames(await listProjects(blankedToken))).toEqual([
      'Made mid-refresh'
    ])

    // …and it is still there once a normal, fully-enriched token comes back.
    const orgAToken = await mintToken(
      multiOrgClaims({ sub, current: REL_ORG_A })
    )
    expect(projectNames(await listProjects(orgAToken))).toEqual([
      'Made mid-refresh'
    ])
  })

  it('falls back to the persisted org context when a refreshed token blanks the claims', async () => {
    // Defra ID runs relationship/role enrichment only on interactive sign-in, so
    // an id_token from a refresh_token grant can arrive with these claims empty.
    // The user's projects must not vanish when that happens.
    const sub = `it-${randomUUID()}`

    const orgAToken = await signInAs(sub, REL_ORG_A)
    await createProject(orgAToken, 'Org A project')

    const blankedToken = await mintToken({
      sub,
      currentRelationshipId: '',
      relationships: [],
      roles: []
    })

    expect(projectNames(await listProjects(blankedToken))).toEqual([
      'Org A project'
    ])
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
