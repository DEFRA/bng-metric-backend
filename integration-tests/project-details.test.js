import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404

let server
let dbClient
let headers
const userId = `it-${randomUUID()}`

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  headers = authHeaders(await mintToken({ sub: userId }))
  await truncateTestData(dbClient)
})

afterEach(async () => {
  await truncateTestData(dbClient)
})

afterAll(async () => {
  await dbClient.end()
  await stopServer(server)
})

async function createProject(name = 'Test Project') {
  const res = await server.inject({
    method: 'POST',
    url: '/projects/new',
    headers,
    payload: { project: { name } }
  })
  expect(res.statusCode).toBe(HTTP_OK)
  return res.result
}

async function patchDetails(id, payload, hdrs = headers) {
  return server.inject({
    method: 'PATCH',
    url: `/projects/${id}/details`,
    headers: hdrs,
    payload
  })
}

describe('GET /projects/{id}/details', () => {
  it('returns {} when the project has no details set', async () => {
    const project = await createProject('No details yet')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}/details`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({})
  })

  it('returns details after they have been set', async () => {
    const project = await createProject('With details')
    const details = {
      localPlanningAuthority: 'Test LPA',
      developmentType: 'Small site'
    }

    await patchDetails(project.id, details)

    const res = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}/details`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject(details)
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/details`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for a non-UUID id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/not-a-uuid/details',
      headers
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 401 without a bearer token', async () => {
    const project = await createProject()
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}/details`
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  it('returns 404 for a project owned by another user', async () => {
    const project = await createProject('Other user project')
    const otherHeaders = authHeaders(
      await mintToken({ sub: `other-${randomUUID()}` })
    )
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}/details`,
      headers: otherHeaders
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })
})

describe('PATCH /projects/{id}/details', () => {
  it('persists details and returns the merged result', async () => {
    const project = await createProject('Patchable')
    const payload = {
      localPlanningAuthority: 'South Downs National Park',
      developmentType: 'Large site',
      nsips: 'Yes'
    }
    const res = await patchDetails(project.id, payload)
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject(payload)

    const { rows } = await dbClient.query(
      `SELECT operation, project, previous_project, user_id
         FROM bng.audit_log
        WHERE project_id = $1
        ORDER BY audited_at DESC, id DESC
        LIMIT 1`,
      [project.id]
    )
    expect(rows[0]).toMatchObject({
      operation: 'UPDATE',
      user_id: userId
    })
    expect(rows[0].previous_project.details).toBeUndefined()
    expect(rows[0].project.details).toMatchObject(payload)
  })

  it('merges partial updates without erasing existing fields', async () => {
    const project = await createProject('Merge test')

    await patchDetails(project.id, {
      localPlanningAuthority: 'First LPA',
      developmentType: 'Small site'
    })

    const res = await patchDetails(project.id, { nsips: 'No' })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.localPlanningAuthority).toBe('First LPA')
    expect(res.result.developmentType).toBe('Small site')
    expect(res.result.nsips).toBe('No')
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await patchDetails(randomUUID(), {
      localPlanningAuthority: 'LPA'
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for an invalid enum value', async () => {
    const project = await createProject()
    const res = await patchDetails(project.id, {
      developmentType: 'Massive site'
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 401 without a bearer token', async () => {
    const project = await createProject()
    const res = await server.inject({
      method: 'PATCH',
      url: `/projects/${project.id}/details`,
      payload: { localPlanningAuthority: 'LPA' }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  it('returns 404 for a project owned by another user', async () => {
    const project = await createProject('RBAC test')
    const otherHeaders = authHeaders(
      await mintToken({ sub: `other-${randomUUID()}` })
    )
    const res = await patchDetails(
      project.id,
      { localPlanningAuthority: 'Hijacked LPA' },
      otherHeaders
    )
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })
})
