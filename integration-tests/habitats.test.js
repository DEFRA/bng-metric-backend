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
const ONE_HECTARE_IN_SQUARE_METRES = 10_000

let server
let dbClient
let headers
const userId = `it-${randomUUID()}`

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  // Seeded projects have a null relationship → visible to their owner (sub).
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

async function seedProjectWithHabitats(habitats) {
  const id = randomUUID()
  const project = {
    name: 'Habitat save IT',
    baseline: { habitats }
  }
  await dbClient.query(
    `INSERT INTO bng.projects (id, project, user_id)
     VALUES ($1, $2, $3)`,
    [id, project, userId]
  )
  return id
}

function habitatFixture(overrides = {}) {
  return {
    featureId: randomUUID(),
    ref: 'A1',
    type: 'Modified grassland',
    broadType: 'Grassland',
    distinctiveness: 'Low',
    distinctivenessScore: 2,
    condition: 'Poor',
    sizeSquareMetres: ONE_HECTARE_IN_SQUARE_METRES,
    ...overrides
  }
}

describe('PUT /projects/{projectId}/habitats/{featureId}', () => {
  it('saves new dropdown values and recomputes derived fields', async () => {
    const habitat = habitatFixture()
    const projectId = await seedProjectWithHabitats([habitat])

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/habitats/${habitat.featureId}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject({
      featureId: habitat.featureId,
      broadType: 'Grassland',
      type: 'Other neutral grassland',
      condition: 'Good',
      distinctiveness: 'Medium',
      distinctivenessScore: 4,
      conditionScore: 3,
      // 1 ha × 4 × 3 = 12
      units: 12,
      status: 'Complete'
    })

    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].project.baseline.habitats[0]).toMatchObject({
      broadType: 'Grassland',
      type: 'Other neutral grassland',
      condition: 'Good',
      units: 12,
      status: 'Complete'
    })
  })

  it('marks the habitat Incomplete with zero units when a dropdown is unset', async () => {
    const habitat = habitatFixture()
    const projectId = await seedProjectWithHabitats([habitat])

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/habitats/${habitat.featureId}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: null
      }
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject({
      conditionScore: null,
      units: 0,
      status: 'Incomplete'
    })
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${randomUUID()}/habitats/${randomUUID()}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 404 when the habitat is not in the project', async () => {
    const projectId = await seedProjectWithHabitats([habitatFixture()])

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/habitats/${randomUUID()}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 when projectId is not a UUID', async () => {
    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/not-a-uuid/habitats/${randomUUID()}`,
      payload: { broadType: null, habitatType: null, condition: null }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 when featureId is not a UUID', async () => {
    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${randomUUID()}/habitats/not-a-uuid`,
      payload: { broadType: null, habitatType: null, condition: null }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 401 without a bearer token', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `/projects/${randomUUID()}/habitats/${randomUUID()}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})
