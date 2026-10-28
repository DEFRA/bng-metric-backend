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
const HTTP_UNPROCESSABLE = 422

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
    `INSERT INTO bng.projects (id, project, user_id, last_modified_by)
     VALUES ($1, $2, $3, $3)`,
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

// The route-coverage check needs every route hit with the service-template
// flag on too, where the legacy upload tests that used to reach this one are
// skipped. Seeding the document directly holds with the flag in either state.
describe('GET /projects/{projectId}/post-intervention/features/{featureId}', () => {
  it('returns 404 when the feature is not in the post-intervention document', async () => {
    const projectId = await seedProjectWithBaseline({ habitats: [] })
    await dbClient.query(
      `UPDATE bng.projects
          SET project = jsonb_set(project, '{postIntervention}', $2::jsonb)
        WHERE id = $1`,
      [projectId, { habitats: [{ featureId: randomUUID(), ref: 'P1' }] }]
    )

    const res = await server.inject({
      headers,
      method: 'GET',
      url: `/projects/${projectId}/post-intervention/features/${randomUUID()}`
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
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
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toMatchObject({
      type: 'habitat',
      feature: {
        featureId: habitat.featureId,
        broadType: 'Grassland',
        type: 'Other neutral grassland',
        condition: 'Good',
        distinctiveness: 'Medium',
        distinctivenessScore: 4,
        conditionScore: 3,
        // 1 ha × 4 × 3 × 1 = 12
        units: 12,
        status: 'Complete'
      }
    })

    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].project.baseline.habitats[0]).toMatchObject({
      units: 12,
      status: 'Complete'
    })
    // Round-trip totals refresh — this is the BMD-480 regression check.
    // The legacy area route shipped without it; the shared helper fixes it
    // for both PUT routes at once.
    expect(rows[0].project.baseline.units).toEqual({
      totalUnits: 12,
      habitatsTotal: 12,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesRuralTotal: 0,
      treesUrbanTotal: 0
    })

    const { rows: auditRows } = await dbClient.query(
      `SELECT operation, project, previous_project, user_id
         FROM bng.audit_log
        WHERE project_id = $1
        ORDER BY audited_at DESC, id DESC
        LIMIT 1`,
      [projectId]
    )
    expect(auditRows[0]).toMatchObject({
      operation: 'UPDATE',
      user_id: userId
    })
    expect(auditRows[0].previous_project.baseline.habitats[0]).toMatchObject({
      condition: 'Poor',
      units: 4
    })
    expect(auditRows[0].project.baseline.habitats[0]).toMatchObject({
      condition: 'Good',
      units: 12
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

describe('PUT /projects/{projectId}/post-intervention/features/{featureId}', () => {
  const RETAINED_IDENTITY = {
    type: 'Modified grassland',
    broadType: 'Grassland',
    condition: 'Poor'
  }

  async function seedRetainedProject({
    retentionCategory = 'Retained',
    otherBaselineHabitats = [],
    postInterventionUnits = {
      totalUnits: 4,
      habitatsTotal: 4,
      hedgerowsTotal: 0,
      watercoursesTotal: 0
    },
    rowRef = 'A1'
  } = {}) {
    const baselineHabitat = {
      featureId: randomUUID(),
      ref: 'A1',
      ...RETAINED_IDENTITY,
      sizeSquareMetres: 10_000,
      units: 4,
      status: 'Complete'
    }
    const retainedRow = {
      featureId: randomUUID(),
      ref: rowRef,
      retentionCategory,
      area: 10_000,
      sizeSquareMetres: 10_000,
      units: 4,
      status: 'Complete',
      baseline: { ...RETAINED_IDENTITY },
      proposed: { ...RETAINED_IDENTITY, advanceYears: 0, delayYears: 0 }
    }
    const projectId = randomUUID()
    await dbClient.query(
      `INSERT INTO bng.projects (id, project, user_id, last_modified_by)
       VALUES ($1, $2, $3, $3)`,
      [
        projectId,
        {
          name: 'Retained ref edit IT',
          baseline: {
            habitats: [baselineHabitat, ...otherBaselineHabitats],
            trees: [],
            hedgerows: [],
            watercourses: [],
            units: {
              totalUnits: 4,
              habitatsTotal: 4,
              hedgerowsTotal: 0,
              watercoursesTotal: 0
            }
          },
          postIntervention: {
            habitats: [retainedRow],
            trees: [],
            hedgerows: [],
            watercourses: [],
            units: postInterventionUnits
          }
        },
        userId
      ]
    )
    return { projectId, baselineHabitat, retainedRow }
  }

  it('renames the retained habitat and the baseline parcel it is joined to', async () => {
    const { projectId, baselineHabitat, retainedRow } =
      await seedRetainedProject()

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/features/${retainedRow.featureId}`,
      payload: { ref: '  P-A1  ' }
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({
      type: 'habitat',
      feature: expect.objectContaining({
        featureId: retainedRow.featureId,
        ref: 'P-A1'
      })
    })

    const { rows } = await dbClient.query(
      `SELECT project, last_modified_by FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    const stored = rows[0].project
    expect(stored.baseline.habitats[0]).toMatchObject({
      featureId: baselineHabitat.featureId,
      ref: 'P-A1'
    })
    expect(stored.postIntervention.habitats[0]).toMatchObject({
      featureId: retainedRow.featureId,
      ref: 'P-A1'
    })
    expect(rows[0].last_modified_by).toBe(userId)
  })

  it('renames a row with no baseline parcel alone, refreshing totals stored without the tree totals', async () => {
    const { projectId, baselineHabitat, retainedRow } =
      await seedRetainedProject({
        rowRef: 'Z9',
        postInterventionUnits: { totalUnits: 4, habitatsTotal: 4 }
      })

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/features/${retainedRow.featureId}`,
      payload: { ref: 'P-Z9' }
    })

    expect(res.statusCode).toBe(HTTP_OK)
    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    const stored = rows[0].project
    expect(stored.postIntervention.habitats[0].ref).toBe('P-Z9')
    expect(stored.postIntervention.units).toMatchObject({
      totalUnits: 4,
      treesTotal: 0
    })
    expect(stored.baseline.habitats[0]).toMatchObject({
      featureId: baselineHabitat.featureId,
      ref: 'A1'
    })
  })

  it('returns 422 HABITAT_REF_IN_USE for a reference another baseline habitat carries, and saves nothing', async () => {
    const { projectId, retainedRow } = await seedRetainedProject({
      otherBaselineHabitats: [
        {
          featureId: randomUUID(),
          ref: 'A2',
          type: 'Other neutral grassland',
          broadType: 'Grassland',
          condition: 'Good',
          sizeSquareMetres: 10_000,
          units: 8,
          status: 'Complete'
        }
      ]
    })

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/features/${retainedRow.featureId}`,
      payload: { ref: 'A2' }
    })

    expect(res.statusCode).toBe(HTTP_UNPROCESSABLE)
    expect(res.result.code).toBe('HABITAT_REF_IN_USE')
    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].project.baseline.habitats[0].ref).toBe('A1')
    expect(rows[0].project.postIntervention.habitats[0].ref).toBe('A1')
  })

  it('returns 400 for a habitat that is not Retained, and saves nothing', async () => {
    const { projectId, retainedRow } = await seedRetainedProject({
      retentionCategory: 'Enhanced'
    })

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/features/${retainedRow.featureId}`,
      payload: { ref: 'P-A1' }
    })

    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
    const { rows } = await dbClient.query(
      `SELECT project FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].project.postIntervention.habitats[0].ref).toBe('A1')
    expect(rows[0].project.baseline.habitats[0].ref).toBe('A1')
  })

  it('returns 400 for a blank reference', async () => {
    const { projectId, retainedRow } = await seedRetainedProject()

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/features/${retainedRow.featureId}`,
      payload: { ref: '   ' }
    })

    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('returns 404 when no post-intervention row has the id', async () => {
    const { projectId, baselineHabitat } = await seedRetainedProject()

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/features/${baselineHabitat.featureId}`,
      payload: { ref: 'P-A1' }
    })

    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${randomUUID()}/post-intervention/features/${randomUUID()}`,
      payload: { ref: 'P-A1' }
    })

    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
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

  it('post-intervention PUT returns 401 without a bearer token', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `/projects/${randomUUID()}/post-intervention/features/${randomUUID()}`,
      payload: { ref: 'P-A1' }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})
