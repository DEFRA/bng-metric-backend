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
const PROJECTS_NEW_URL = '/projects/new'

let server
let dbClient
let headers
const userId = `it-${randomUUID()}`

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  // No current relationship → created projects get a null relationship and stay
  // visible to their owner (the token `sub`). RBAC role gating is exercised in
  // defra-id-rbac.test.js.
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

async function createProject(name) {
  const res = await server.inject({
    method: 'POST',
    url: PROJECTS_NEW_URL,
    headers,
    payload: { project: { name } }
  })
  expect(res.statusCode).toBe(HTTP_OK)
  return res.result
}

describe('POST /projects/new', () => {
  it('creates a project with a generated UUID, owned by the token subject', async () => {
    const created = await createProject('New Project')
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(created.project.name).toBe('New Project')
    expect(created.userId).toBe(userId)
  })

  it('returns 401 without a bearer token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: PROJECTS_NEW_URL,
      payload: { project: { name: 'No token' } }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  it('returns 400 when a userId is supplied in the body', async () => {
    const res = await server.inject({
      method: 'POST',
      url: PROJECTS_NEW_URL,
      headers,
      payload: { project: { name: 'With userId' }, userId }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 when project is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: PROJECTS_NEW_URL,
      headers,
      payload: {}
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})

describe('GET /projects', () => {
  it('returns only the requesting user’s visible projects', async () => {
    await createProject('First')
    await createProject('Second')

    const res = await server.inject({
      method: 'GET',
      url: '/projects',
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toHaveLength(2)
    const names = res.result.map((p) => p.project.name).sort()
    expect(names).toEqual(['First', 'Second'])
  })

  it('returns 401 without a bearer token', async () => {
    const res = await server.inject({ method: 'GET', url: '/projects' })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  // BMD-933: the list must not carry the project document body.
  it('excludes the document body and reports has-baseline instead', async () => {
    const created = await createProject('Listed')
    await dbClient.query(
      `UPDATE bng.projects
          SET project = project || $2::jsonb
        WHERE id = $1`,
      [created.id, JSON.stringify({ baseline: { habitats: [{ area: 1 }] } })]
    )

    const res = await server.inject({
      method: 'GET',
      url: '/projects',
      headers
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual([
      {
        id: created.id,
        projectId: created.id,
        project: { name: 'Listed' },
        has_baseline: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      }
    ])
  })

  it('reports has_baseline false before any baseline is uploaded', async () => {
    await createProject('No Baseline')

    const res = await server.inject({
      method: 'GET',
      url: '/projects',
      headers
    })

    expect(res.result.map((p) => p.has_baseline)).toEqual([false])
  })

  it('bounds the list with limit and offset', async () => {
    await createProject('First')
    await createProject('Second')
    await createProject('Third')

    const page = async (query) =>
      (
        await server.inject({
          method: 'GET',
          url: `/projects?${query}`,
          headers
        })
      ).result.map((p) => p.project.name)

    const first = await page('limit=2')
    const second = await page('limit=2&offset=2')

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(1)
    expect([...first, ...second].sort()).toEqual(['First', 'Second', 'Third'])
  })

  it.each(['limit=0', 'limit=501', 'offset=-1'])(
    'returns 400 for ?%s',
    async (query) => {
      const res = await server.inject({
        method: 'GET',
        url: `/projects?${query}`,
        headers
      })
      expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
    }
  )
})

describe('GET /projects/{id}', () => {
  it('returns a project by id', async () => {
    const created = await createProject('Findable')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.id).toBe(created.id)
    expect(res.result.project.name).toBe('Findable')
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for a non-UUID id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/not-a-uuid',
      headers
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 401 without a bearer token', async () => {
    const created = await createProject('Needs token')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}`
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})

describe('GET /projects/{projectId}/habitats/{featureId}', () => {
  it('returns the habitat document for a matching featureId', async () => {
    const featureId = randomUUID()
    const habitat = {
      featureId,
      ref: '1',
      type: 'Grassland - Modified grassland',
      broadType: 'Grassland',
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      condition: 'Good',
      sizeSquareMetres: 12345,
      // `status` is required by habitatSchema; POST /projects/new now validates
      // the document against projectSchema (via persist-project.js).
      status: 'Complete'
    }
    const created = await server.inject({
      method: 'POST',
      url: PROJECTS_NEW_URL,
      headers,
      payload: {
        project: {
          name: 'With baseline habitats',
          baseline: { habitats: [habitat] }
        }
      }
    })
    expect(created.statusCode).toBe(HTTP_OK)

    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.result.id}/habitats/${featureId}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual(habitat)
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/habitats/${randomUUID()}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 404 when the project has no matching habitat', async () => {
    const created = await createProject('Has no baseline')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}/habitats/${randomUUID()}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for a non-UUID featureId', async () => {
    const created = await createProject('Bad feature id')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}/habitats/not-a-uuid`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})

describe('PATCH /projects/{id}', () => {
  it('updates the project name', async () => {
    const created = await createProject('Original')
    const res = await server.inject({
      method: 'PATCH',
      url: `/projects/${created.id}`,
      headers,
      payload: { project: { name: 'Renamed' } }
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.project.name).toBe('Renamed')
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/projects/${randomUUID()}`,
      headers,
      payload: { project: { name: 'Renamed' } }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 when name is empty', async () => {
    const created = await createProject('Original')
    const res = await server.inject({
      method: 'PATCH',
      url: `/projects/${created.id}`,
      headers,
      payload: { project: { name: '' } }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 for a non-UUID id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/projects/not-a-uuid',
      headers,
      payload: { project: { name: 'X' } }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 401 without a bearer token', async () => {
    const created = await createProject('Original')
    const res = await server.inject({
      method: 'PATCH',
      url: `/projects/${created.id}`,
      payload: { project: { name: 'Renamed' } }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})
