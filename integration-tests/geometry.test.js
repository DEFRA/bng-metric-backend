import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404

let server
let dbClient
/** @type {Record<string, string>} */
let headers

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  await truncateTestData(dbClient)
  // Every route inherits the server's default 'defra-jwt' strategy, so each
  // request needs a valid bearer token minted against the test JWKS.
  headers = authHeaders(await mintToken())
})

afterAll(async () => {
  await truncateTestData(dbClient)
  await dbClient.end()
  await stopServer(server)
})

describe('GET /projects/{projectId}/baseline/geometry', () => {
  it('returns 400 for a non-UUID projectId', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/not-a-uuid/baseline/geometry',
      headers
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 404 for an unknown projectId', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/baseline/geometry`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns empty collections for a project with no baseline', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/projects/new',
      headers,
      payload: {
        project: { name: 'GeoJSON test' }
      }
    })
    expect(created.statusCode).toBe(HTTP_OK)

    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.result.id}/baseline/geometry`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.crs.properties.name).toBe('EPSG:4326')
    expect(res.result.redLine).toBeNull()
    expect(res.result.areaHabitats.features).toEqual([])
    expect(res.result.hedgerows.features).toEqual([])
    expect(res.result.watercourses.features).toEqual([])
  })
})

describe('GET /projects/{projectId}/post-intervention/geometry', () => {
  it('returns 400 for a non-UUID projectId', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/not-a-uuid/post-intervention/geometry',
      headers
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 404 for an unknown projectId', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/projects/${randomUUID()}/post-intervention/geometry`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns empty collections for a project with no post-intervention', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/projects/new',
      headers,
      payload: {
        project: { name: 'PI GeoJSON test' }
      }
    })
    expect(created.statusCode).toBe(HTTP_OK)

    const res = await server.inject({
      method: 'GET',
      url: `/projects/${created.result.id}/post-intervention/geometry`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.crs.properties.name).toBe('EPSG:4326')
    expect(res.result.redLine).toBeNull()
    expect(res.result.areaHabitats.features).toEqual([])
    expect(res.result.hedgerows.features).toEqual([])
    expect(res.result.watercourses.features).toEqual([])
  })
})
