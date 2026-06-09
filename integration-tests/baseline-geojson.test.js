import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404

let server
let dbClient

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  await truncateTestData(dbClient)
})

afterAll(async () => {
  await truncateTestData(dbClient)
  await dbClient.end()
  await stopServer(server)
})

describe('GET /projects/{projectId}/baseline/geojson', () => {
  it('returns 400 for a non-UUID projectId', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/not-a-uuid/baseline/geojson'
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 404 for an unknown projectId', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/baseline/geojson`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns empty collections for a project with no baseline', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/projects/new',
      payload: {
        project: { name: 'GeoJSON test' },
        userId: `it-${randomUUID()}`
      }
    })
    expect(created.statusCode).toBe(HTTP_OK)

    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.result.id}/baseline/geojson`
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.crs.properties.name).toBe('EPSG:4326')
    expect(res.result.redLine).toBeNull()
    expect(res.result.areaHabitats.features).toEqual([])
    expect(res.result.hedgerows.features).toEqual([])
    expect(res.result.watercourses.features).toEqual([])
  })
})
