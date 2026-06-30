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

describe('GET /project-details/{id}', () => {
  it('returns {} when the project has no details set', async () => {
    const project = await createProject('No details yet')
    const res = await server.inject({
      method: 'GET',
      url: `/project-details/${project.id}`,
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

    await server.inject({
      method: 'PATCH',
      url: `/project-details/${project.id}`,
      headers,
      payload: details
    })

    const res = await server.inject({
      method: 'GET',
      url: `/project-details/${project.id}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject(details)
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/project-details/${randomUUID()}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for a non-UUID id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/project-details/not-a-uuid',
      headers
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 401 without a bearer token', async () => {
    const project = await createProject()
    const res = await server.inject({
      method: 'GET',
      url: `/project-details/${project.id}`
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
      url: `/project-details/${project.id}`,
      headers: otherHeaders
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })
})

describe('PATCH /project-details/{id}', () => {
  it('persists details and returns the merged result', async () => {
    const project = await createProject('Patchable')
    const payload = {
      localPlanningAuthority: 'South Downs National Park',
      developmentType: 'Large site',
      nsips: 'Yes'
    }
    const res = await server.inject({
      method: 'PATCH',
      url: `/project-details/${project.id}`,
      headers,
      payload
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject(payload)
  })

  it('merges partial updates without erasing existing fields', async () => {
    const project = await createProject('Merge test')

    await server.inject({
      method: 'PATCH',
      url: `/project-details/${project.id}`,
      headers,
      payload: {
        localPlanningAuthority: 'First LPA',
        developmentType: 'Small site'
      }
    })

    const res = await server.inject({
      method: 'PATCH',
      url: `/project-details/${project.id}`,
      headers,
      payload: { nsips: 'No' }
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.localPlanningAuthority).toBe('First LPA')
    expect(res.result.developmentType).toBe('Small site')
    expect(res.result.nsips).toBe('No')
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/project-details/${randomUUID()}`,
      headers,
      payload: { localPlanningAuthority: 'LPA' }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for an invalid enum value', async () => {
    const project = await createProject()
    const res = await server.inject({
      method: 'PATCH',
      url: `/project-details/${project.id}`,
      headers,
      payload: { developmentType: 'Massive site' }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 401 without a bearer token', async () => {
    const project = await createProject()
    const res = await server.inject({
      method: 'PATCH',
      url: `/project-details/${project.id}`,
      payload: { localPlanningAuthority: 'LPA' }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  it('returns 404 for a project owned by another user', async () => {
    const project = await createProject('RBAC test')
    const otherHeaders = authHeaders(
      await mintToken({ sub: `other-${randomUUID()}` })
    )
    const res = await server.inject({
      method: 'PATCH',
      url: `/project-details/${project.id}`,
      headers: otherHeaders,
      payload: { localPlanningAuthority: 'Hijacked LPA' }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })
})
