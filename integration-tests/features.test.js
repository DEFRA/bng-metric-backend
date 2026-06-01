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
      method: 'GET',
      url: `/projects/${projectId}/features/${watercourse.featureId}`
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ type: 'watercourse', feature: watercourse })
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await server.inject({
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
      method: 'GET',
      url: `/projects/${projectId}/features/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 400 when projectId is not a UUID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/not-a-uuid/features/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 400 when featureId is not a UUID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/features/not-a-uuid`
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})
