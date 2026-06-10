import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404
const PROJECTS_NEW_URL = '/projects/new'

let server
let dbClient
const userId = `it-${randomUUID()}`

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

async function createProject(name) {
  const res = await server.inject({
    method: 'POST',
    url: PROJECTS_NEW_URL,
    payload: { project: { name }, userId }
  })
  expect(res.statusCode).toBe(HTTP_OK)
  return res.result
}

describe('POST /projects/new', () => {
  it('creates a project with a generated UUID', async () => {
    const created = await createProject('New Project')
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(created.project.name).toBe('New Project')
    expect(created.userId).toBe(userId)
  })

  it('returns 400 when userId is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: PROJECTS_NEW_URL,
      payload: { project: { name: 'No User' } }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 when project is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: PROJECTS_NEW_URL,
      payload: { userId }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})

describe('GET /projects', () => {
  it('returns all projects', async () => {
    await createProject('First')
    await createProject('Second')

    const res = await server.inject({ method: 'GET', url: '/projects' })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toHaveLength(2)
    const names = res.result.map((p) => p.project.name).sort()
    expect(names).toEqual(['First', 'Second'])
  })
})

describe('GET /projects/{id}', () => {
  it('returns a project by id', async () => {
    const created = await createProject('Findable')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}`
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.id).toBe(created.id)
    expect(res.result.project.name).toBe('Findable')
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for a non-UUID id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/not-a-uuid'
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
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
      payload: {
        project: {
          name: 'With baseline habitats',
          baseline: { habitats: [habitat] }
        },
        userId
      }
    })
    expect(created.statusCode).toBe(HTTP_OK)

    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.result.id}/habitats/${featureId}`
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual(habitat)
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/habitats/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 404 when the project has no matching habitat', async () => {
    const created = await createProject('Has no baseline')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}/habitats/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 for a non-UUID featureId', async () => {
    const created = await createProject('Bad feature id')
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.id}/habitats/not-a-uuid`
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
      payload: { project: { name: 'Renamed' } }
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.project.name).toBe('Renamed')
  })

  it('returns 404 for an unknown UUID', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/projects/${randomUUID()}`,
      payload: { project: { name: 'Renamed' } }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 when name is empty', async () => {
    const created = await createProject('Original')
    const res = await server.inject({
      method: 'PATCH',
      url: `/projects/${created.id}`,
      payload: { project: { name: '' } }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 for a non-UUID id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/projects/not-a-uuid',
      payload: { project: { name: 'X' } }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})
