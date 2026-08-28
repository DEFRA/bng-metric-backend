import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
// Comfortably above one projected row, far below the seeded document.
const MAX_LIST_ROW_BYTES = 1000

let server
let dbClient
let headers
const userId = randomUUID()
const otherUserId = randomUUID()

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  // Identity comes from the token `sub`; the seeded projects have a null
  // relationship so they are visible to their owner.
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

// Insert three projects with deterministic names + timestamps so we can
// assert sort/order combinations. created_at and updated_at are set
// explicitly to defeat default-now collisions on fast hardware.
async function seedThree() {
  const rows = [
    {
      id: randomUUID(),
      name: 'Charlie',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-03-01T00:00:00Z'
    },
    {
      id: randomUUID(),
      name: 'Alpha',
      createdAt: '2024-02-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    },
    {
      id: randomUUID(),
      name: 'Bravo',
      createdAt: '2024-03-01T00:00:00Z',
      updatedAt: '2024-02-01T00:00:00Z'
    }
  ]
  for (const row of rows) {
    await dbClient.query(
      `INSERT INTO bng.projects (id, project, user_id, last_modified_by, created_at, updated_at)
       VALUES ($1, $2, $3, $3, $4, $5)`,
      [
        row.id,
        JSON.stringify({ name: row.name }),
        userId,
        row.createdAt,
        row.updatedAt
      ]
    )
  }
  return rows
}

describe('GET /users/{userId}/projects sorting', () => {
  it('defaults to sort=updated_at,order=desc', async () => {
    await seedThree()
    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.map((r) => r.project.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha'
    ])
  })

  it('supports sort=created_at,order=asc', async () => {
    await seedThree()
    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects?sort=created_at&order=asc`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.map((r) => r.project.name)).toEqual([
      'Charlie',
      'Alpha',
      'Bravo'
    ])
  })

  it('supports sort=name,order=asc', async () => {
    await seedThree()
    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects?sort=name&order=asc`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.map((r) => r.project.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie'
    ])
  })

  it('returns an empty array for a user with no projects', async () => {
    // The identity is the token subject, not the path param: a different user
    // sees none of the seeded projects.
    const otherHeaders = authHeaders(await mintToken({ sub: otherUserId }))
    const res = await server.inject({
      method: 'GET',
      url: `/users/${otherUserId}/projects`,
      headers: otherHeaders
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual([])
  })
})

// BMD-933: the list page renders three columns, so the endpoint must not ship
// the project document. `seedThree` writes name-only documents, so these tests
// seed a project with a real baseline to prove the body is left in Postgres.
describe('GET /users/{userId}/projects list projection', () => {
  async function seedWithBaseline() {
    const id = randomUUID()
    await dbClient.query(
      `INSERT INTO bng.projects (id, project, user_id, last_modified_by)
       VALUES ($1, $2, $3, $3)`,
      [
        id,
        JSON.stringify({
          name: 'Has Baseline',
          baseline: {
            habitats: Array.from({ length: 200 }, (_, i) => ({
              featureId: randomUUID(),
              ref: `parcel-${i}`,
              area: i
            }))
          },
          postIntervention: { habitats: [] }
        }),
        userId
      ]
    )
    return id
  }

  it('excludes the document body and reports has-baseline instead', async () => {
    const id = await seedWithBaseline()

    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects`,
      headers
    })

    expect(res.statusCode).toBe(HTTP_OK)
    const [row] = res.result
    expect(row).toEqual({
      id,
      projectId: id,
      project: { name: 'Has Baseline' },
      has_baseline: true,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date)
    })
    expect(row.project).not.toHaveProperty('baseline')
    expect(row.project).not.toHaveProperty('postIntervention')
  })

  it('keeps the payload flat regardless of how large the baseline is', async () => {
    await seedWithBaseline()

    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects`,
      headers
    })

    // The stored document is orders of magnitude bigger than this.
    expect(res.payload.length).toBeLessThan(MAX_LIST_ROW_BYTES)
  })

  it('reports has_baseline false for a project with no baseline yet', async () => {
    await seedThree()

    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects`,
      headers
    })

    expect(res.result.map((r) => r.has_baseline)).toEqual([false, false, false])
  })
})

describe('GET /users/{userId}/projects pagination', () => {
  it('returns at most `limit` projects', async () => {
    await seedThree()

    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects?sort=name&order=asc&limit=2`,
      headers
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.map((r) => r.project.name)).toEqual(['Alpha', 'Bravo'])
  })

  it('skips `offset` projects', async () => {
    await seedThree()

    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects?sort=name&order=asc&limit=2&offset=1`,
      headers
    })

    expect(res.result.map((r) => r.project.name)).toEqual(['Bravo', 'Charlie'])
  })

  it('walks the whole list without repeating or dropping a project', async () => {
    await seedThree()
    const seen = []

    for (let offset = 0; offset < 3; offset += 1) {
      const res = await server.inject({
        method: 'GET',
        url: `/users/${userId}/projects?limit=1&offset=${offset}`,
        headers
      })
      seen.push(...res.result.map((r) => r.project.name))
    }

    expect(seen.sort()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('returns an empty page past the end of the list', async () => {
    await seedThree()

    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects?offset=100`,
      headers
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual([])
  })
})

describe('GET /users/{userId}/projects auth + validation', () => {
  it('returns 401 without a bearer token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects`
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  it('returns 400 for an invalid sort value', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/users/${userId}/projects?sort=bogus`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it.each(['limit=0', 'limit=501', 'limit=abc', 'offset=-1'])(
    'returns 400 for ?%s',
    async (query) => {
      const res = await server.inject({
        method: 'GET',
        url: `/users/${userId}/projects?${query}`,
        headers
      })
      expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
    }
  )
})
