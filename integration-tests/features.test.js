import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import {
  HTTP_OK,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND
} from './helpers/http-status.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_UNAUTHORIZED = 401

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

async function seedProjectWithBaseline(baseline) {
  const id = randomUUID()
  await dbClient.query(
    `INSERT INTO bng.projects (id, project, user_id)
     VALUES ($1, $2, $3)`,
    [id, { name: 'Features endpoint IT', baseline }, userId]
  )
  return id
}

describe('GET /projects/{projectId}/features/{featureId}', () => {
  it('returns { type: "habitat", feature } for an area habitat', async () => {
    const habitat = {
      featureId: randomUUID(),
      ref: 'A1',
      type: 'Modified grassland',
      broadType: 'Grassland'
    }
    const projectId = await seedProjectWithBaseline({ habitats: [habitat] })

    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/${projectId}/features/${habitat.featureId}`
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ type: 'habitat', feature: habitat })
  })

  it('returns { type: "hedgerow", feature } for a hedgerow', async () => {
    const hedgerow = {
      featureId: randomUUID(),
      ref: 'H1',
      type: 'Native hedgerow',
      sizeMetres: 1234
    }
    const projectId = await seedProjectWithBaseline({ hedgerows: [hedgerow] })

    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/${projectId}/features/${hedgerow.featureId}`
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ type: 'hedgerow', feature: hedgerow })
  })

  it('returns { type: "watercourse", feature } for a watercourse', async () => {
    const watercourse = {
      featureId: randomUUID(),
      ref: 'W1',
      type: 'River',
      sizeMetres: 567
    }
    const projectId = await seedProjectWithBaseline({
      watercourses: [watercourse]
    })

    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/${projectId}/features/${watercourse.featureId}`
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ type: 'watercourse', feature: watercourse })
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/${randomUUID()}/features/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 404 when the feature is not in any layer', async () => {
    const projectId = await seedProjectWithBaseline({
      habitats: [{ featureId: randomUUID(), ref: 'A1' }]
    })

    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/${projectId}/features/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 when projectId is not a UUID', async () => {
    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/not-a-uuid/features/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 when featureId is not a UUID', async () => {
    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/${randomUUID()}/features/not-a-uuid`
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})

describe('PUT /projects/{projectId}/features/{featureId}', () => {
  const ONE_HECTARE_IN_SQUARE_METRES = 10_000

  it('dispatches to the area-habitat recompute and persists the canonical shape', async () => {
    const habitat = {
      featureId: randomUUID(),
      ref: 'A1',
      type: 'Modified grassland',
      broadType: 'Grassland',
      condition: 'Poor',
      sizeSquareMetres: ONE_HECTARE_IN_SQUARE_METRES,
      units: 4
    }
    const projectId = await seedProjectWithBaseline({
      habitats: [habitat],
      hedgerows: [],
      watercourses: [],
      units: {
        totalUnits: 4,
        habitatsTotal: 4,
        hedgerowsTotal: 0,
        watercoursesTotal: 0
      }
    })

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/features/${habitat.featureId}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject({
      type: 'habitat',
      feature: {
        featureId: habitat.featureId,
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: 'Good',
        distinctiveness: 'V.High',
        distinctivenessScore: 8,
        conditionScore: 3,
        // 1 ha × 8 × 3 × 1 = 24
        units: 24,
        status: 'Complete'
      }
    })

    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].project.baseline.habitats[0]).toMatchObject({
      units: 24,
      status: 'Complete'
    })
    // Round-trip totals refresh — this is the BMD-480 regression check.
    // The legacy area route shipped without it; the shared helper fixes it
    // for both PUT routes at once.
    expect(rows[0].project.baseline.units).toEqual({
      totalUnits: 24,
      habitatsTotal: 24,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesRuralTotal: 0,
      treesUrbanTotal: 0
    })
  })

  it('dispatches to the hedgerow recompute and writes the hedgerow layer', async () => {
    const hedgerow = {
      featureId: randomUUID(),
      ref: 'H1',
      type: null,
      condition: null,
      sizeMetres: 1000
    }
    const projectId = await seedProjectWithBaseline({
      habitats: [],
      hedgerows: [hedgerow],
      watercourses: []
    })

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/features/${hedgerow.featureId}`,
      payload: {
        habitatType: 'Native hedgerow',
        condition: 'Good'
      }
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.type).toBe('hedgerow')
    // 1 km × Low (2) × Good (3) × 1 SS = 6 units. Pins the full
    // request → recompute → engine → persistence loop.
    expect(res.result.feature).toMatchObject({
      featureId: hedgerow.featureId,
      type: 'Native hedgerow',
      condition: 'Good',
      status: 'Complete',
      units: 6
    })

    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].project.baseline.hedgerows[0]).toMatchObject({
      type: 'Native hedgerow',
      condition: 'Good',
      status: 'Complete',
      units: 6
    })
    expect(rows[0].project.baseline.habitats).toEqual([])
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${randomUUID()}/features/${randomUUID()}`,
      payload: { habitatType: 'Lowland meadows', condition: 'Good' }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 404 when the feature is not in any layer', async () => {
    const projectId = await seedProjectWithBaseline({
      habitats: [{ featureId: randomUUID(), ref: 'A1' }]
    })

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/features/${randomUUID()}`,
      payload: { habitatType: 'Lowland meadows', condition: 'Good' }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 when projectId is not a UUID', async () => {
    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/not-a-uuid/features/${randomUUID()}`,
      payload: { habitatType: null, condition: null }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 when featureId is not a UUID', async () => {
    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${randomUUID()}/features/not-a-uuid`,
      payload: { habitatType: null, condition: null }
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})

describe('feature endpoints require authentication', () => {
  it('GET returns 401 without a bearer token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/features/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  it('PUT returns 401 without a bearer token', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `/projects/${randomUUID()}/features/${randomUUID()}`,
      payload: { habitatType: 'Lowland meadows', condition: 'Good' }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})
