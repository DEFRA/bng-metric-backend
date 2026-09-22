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

async function seedProject(project) {
  const id = randomUUID()
  await dbClient.query(
    `INSERT INTO bng.projects (id, project, user_id, last_modified_by)
     VALUES ($1, $2, $3, $3)`,
    [id, project, userId]
  )
  return id
}

async function seedProjectWithHabitats(habitats) {
  const id = randomUUID()
  const project = {
    name: 'Habitat save IT',
    baseline: { habitats }
  }
  await dbClient.query(
    `INSERT INTO bng.projects (id, project, user_id, last_modified_by)
     VALUES ($1, $2, $3, $3)`,
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

describe('PUT /projects/{projectId}/habitats/{featureId} — with a post-intervention document', () => {
  // The post-intervention document keeps its own copy of the baseline and every
  // figure it carries is measured against it, so a baseline edit re-derives the
  // whole document. This covers the part the unit tests mock: that the
  // re-derived document actually reaches the JSONB column, in the same write as
  // the baseline feature.
  function seedBoth() {
    const baselineHabitat = habitatFixture({ units: 2, status: 'Complete' })
    return {
      baselineHabitat,
      project: {
        name: 'Baseline edit with post-intervention IT',
        baseline: {
          habitats: [baselineHabitat],
          trees: [],
          hedgerows: [],
          watercourses: [],
          units: {
            totalUnits: 2,
            habitatsTotal: 2,
            hedgerowsTotal: 0,
            watercoursesTotal: 0
          }
        },
        postIntervention: {
          habitats: [
            {
              // featureIds are assigned per document — the join is on `ref`.
              featureId: randomUUID(),
              ref: baselineHabitat.ref,
              retentionCategory: 'Retained',
              area: ONE_HECTARE_IN_SQUARE_METRES,
              sizeSquareMetres: ONE_HECTARE_IN_SQUARE_METRES,
              units: 2,
              status: 'Complete',
              baseline: {
                type: 'Modified grassland',
                broadType: 'Grassland',
                condition: 'Poor'
              },
              proposed: {
                type: 'Modified grassland',
                broadType: 'Grassland',
                condition: 'Poor',
                advanceYears: 0,
                delayYears: 0
              }
            }
          ],
          trees: [],
          hedgerows: [],
          watercourses: [],
          units: { totalUnits: 2, habitatsTotal: 2 }
        }
      }
    }
  }

  it('persists the re-derived post-intervention document alongside the edit', async () => {
    const { baselineHabitat, project } = seedBoth()
    const projectId = await seedProject(project)

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/habitats/${baselineHabitat.featureId}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })

    expect(res.statusCode).toBe(HTTP_OK)

    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    const stored = rows[0].project

    // The baseline edit landed.
    expect(stored.baseline.habitats[0]).toMatchObject({
      type: 'Other neutral grassland',
      condition: 'Good',
      units: 12
    })

    // The post-intervention copy of the baseline came with it, proposed side
    // included — the parcel is Retained, so its proposed identity tracked the
    // baseline it was copied from at import.
    const [storedPostIntervention] = stored.postIntervention.habitats
    expect(storedPostIntervention.baseline).toMatchObject({
      type: 'Other neutral grassland',
      broadType: 'Grassland',
      condition: 'Good'
    })
    expect(storedPostIntervention.proposed).toMatchObject({
      type: 'Other neutral grassland',
      condition: 'Good'
    })

    // And every figure measured against the baseline was recomputed. A Retained
    // parcel delivers exactly what the baseline holds, so it nets out.
    expect(stored.postIntervention.units.habitatsTotal).toBe(12)
    expect(stored.postIntervention.units.habitatsNetUnitChange).toBe(0)
    expect(
      stored.postIntervention.tradingRules.areaHabitats.habitatTypes
    ).toEqual([
      expect.objectContaining({
        habitatType: 'Grassland - Other neutral grassland',
        netUnitChange: 0
      })
    ])
  })

  it('leaves the document alone when the project has no post-intervention data', async () => {
    const habitat = habitatFixture({ units: 2, status: 'Complete' })
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
    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].project.postIntervention).toBeUndefined()
  })
})
