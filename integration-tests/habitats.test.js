import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'
import {
  calculateCreatedWatercoursePostIntervention,
  roundToSigFigs
} from 'bng-library/metric'

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

  it('marks the habitat Incomplete with null units when a dropdown is unset', async () => {
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
      units: null,
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

// The route-coverage check needs every route hit with the service-template
// flag on too, where the legacy upload tests that used to reach this one are
// skipped. Seeding the document directly holds with the flag in either state.
describe('PUT /projects/{projectId}/post-intervention/habitats/{featureId}', () => {
  it('returns 404 when the habitat is not in the post-intervention document', async () => {
    const projectId = await seedProject({
      name: 'Post-intervention habitat save IT',
      baseline: { habitats: [habitatFixture()] },
      postIntervention: { habitats: [] }
    })

    const res = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/habitats/${randomUUID()}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
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

  it('removes stale watercourse units from the saved post-intervention totals after a baseline edit', async () => {
    const { baselineHabitat, project } = seedBoth()
    const attributes = {
      type: 'Ditches',
      condition: 'Good',
      watercourseEncroachment: null,
      riparianEncroachment: 'No Encroachment/No Encroachment'
    }
    project.postIntervention.watercourses = [
      {
        featureId: randomUUID(),
        ref: 'R1',
        retentionCategory: 'Retained',
        sizeMetres: 1000,
        units: 12,
        status: 'Complete',
        baseline: { ...attributes },
        proposed: { ...attributes }
      }
    ]
    project.postIntervention.units = {
      totalUnits: 14,
      habitatsTotal: 2,
      watercoursesTotal: 12
    }
    const projectId = await seedProject(project)
    const response = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${projectId}/habitats/${baselineHabitat.featureId}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })
    expect(response.statusCode).toBe(HTTP_OK)
    const { rows } = await dbClient.query(
      'SELECT project FROM bng.projects WHERE id = $1',
      [projectId]
    )
    const stored = rows[0].project.postIntervention
    expect(stored.watercourses[0]).toMatchObject({
      units: null,
      status: 'Incomplete'
    })
    expect(stored.units.watercoursesTotal).toBe(0)
    expect(stored.units.habitatsTotal).toBe(12)
    expect(stored.units.totalUnits).toBe(12)
  })

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

describe('BMD-1048 Created area editing', () => {
  it('persists complete and incomplete edits and rejects conflicting timing without writing', async () => {
    const feature = {
      featureId: randomUUID(),
      ref: 'P-1',
      retentionCategory: 'Created',
      sizeSquareMetres: ONE_HECTARE_IN_SQUARE_METRES,
      units: 0,
      status: 'Incomplete',
      baseline: {},
      proposed: {}
    }
    const projectId = await seedProject({
      name: 'Created area editing IT',
      postIntervention: { habitats: [feature] }
    })
    await dbClient.query(
      `INSERT INTO bng.post_intervention_habitats (id, project_id, ref, geom)
       VALUES ($1, $2, $3, ST_Multi(ST_MakeEnvelope(530000, 180000, 530100, 180100, 27700)))`,
      [feature.featureId, projectId, feature.ref]
    )
    const readGeometry = async () => {
      const { rows } = await dbClient.query(
        'SELECT ref, ST_AsText(geom) AS geometry FROM bng.post_intervention_habitats WHERE id = $1 AND project_id = $2',
        [feature.featureId, projectId]
      )
      return rows[0]
    }
    const originalGeometry = await readGeometry()
    const url = `/projects/${projectId}/post-intervention/habitats/${feature.featureId}`
    const payload = {
      ref: 'New reference',
      broadType: 'Grassland',
      habitatType: 'Modified grassland',
      condition: 'Good',
      strategicSignificance: 'High',
      advanceYears: 0,
      delayYears: '30+'
    }
    const saved = await server.inject({ method: 'PUT', url, headers, payload })
    expect(saved.statusCode).toBe(HTTP_OK)
    expect(saved.result).toMatchObject({
      ref: 'New reference',
      status: 'Complete',
      proposed: {
        delayYears: 30,
        delayYearsIs30Plus: true,
        advanceYears: 0,
        advanceYearsIs30Plus: false
      }
    })
    expect(saved.result.units).toBeGreaterThan(0)
    const readProject = async () => {
      const { rows } = await dbClient.query(
        'SELECT project, last_modified_by FROM bng.projects WHERE id = $1',
        [projectId]
      )
      return rows[0]
    }
    const complete = await readProject()
    expect(complete.project.postIntervention.habitats[0]).toEqual(saved.result)
    expect(
      typeof complete.project.postIntervention.habitats[0].proposed.delayYears
    ).toBe('number')
    expect(complete.project.postIntervention.units.habitatsTotal).toBe(
      saved.result.units
    )
    expect(complete.last_modified_by).toBe(userId)
    expect(await readGeometry()).toEqual({
      ...originalGeometry,
      ref: payload.ref
    })

    const rejected = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, advanceYears: 1, delayYears: 1 }
    })
    expect(rejected.statusCode).toBe(HTTP_BAD_REQUEST)
    expect(await readProject()).toEqual(complete)
    expect(await readGeometry()).toEqual({
      ...originalGeometry,
      ref: payload.ref
    })

    for (const invalid of [
      { broadType: 'Urban' },
      { habitatType: 'Lowland meadows' },
      { condition: 'Not Possible' }
    ]) {
      const invalidChoice = await server.inject({
        method: 'PUT',
        url,
        headers,
        payload: { ...payload, ...invalid }
      })
      expect(invalidChoice.statusCode).toBe(HTTP_BAD_REQUEST)
      expect(await readProject()).toEqual(complete)
      expect(await readGeometry()).toEqual({
        ...originalGeometry,
        ref: payload.ref
      })
    }

    const partial = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, delayYears: null }
    })
    expect(partial.statusCode).toBe(HTTP_OK)
    expect(partial.result).toMatchObject({
      units: 0,
      status: 'Incomplete',
      proposed: {
        delayYears: null,
        distinctiveness: null,
        difficulty: null,
        difficultyMultiplier: null,
        finalTimeToTargetCondition: null
      }
    })
    const incomplete = await readProject()
    expect(incomplete.project.postIntervention.habitats[0]).toEqual(
      partial.result
    )
    expect(incomplete.project.postIntervention.units.habitatsTotal).toBe(0)
  })
})

describe('BMD-1049 Created hedgerow editing', () => {
  it('persists hedgerow edits, nulls and totals, rejects invalid timing, and requires authentication', async () => {
    const feature = {
      featureId: randomUUID(),
      ref: 'H-1',
      retentionCategory: 'Created',
      sizeMetres: 336,
      units: 0,
      status: 'Incomplete',
      baseline: {},
      proposed: {}
    }
    const projectId = await seedProject({
      name: 'Created hedgerow editing IT',
      postIntervention: { hedgerows: [feature] }
    })
    const url = `/projects/${projectId}/post-intervention/hedgerows/${feature.featureId}`
    const payload = {
      ref: 'New hedge',
      habitatType: 'Native hedgerow',
      condition: 'Good',
      strategicSignificance: 'High',
      advanceYears: 0,
      delayYears: '30+'
    }
    const anonymous = await server.inject({ method: 'PUT', url, payload })
    expect(anonymous.statusCode).toBe(HTTP_UNAUTHORIZED)
    const saved = await server.inject({ method: 'PUT', url, headers, payload })
    expect(saved.statusCode).toBe(HTTP_OK)
    expect(saved.result).toMatchObject({
      ref: payload.ref,
      sizeMetres: 336,
      status: 'Complete',
      proposed: { delayYears: 30, delayYearsIs30Plus: true }
    })
    expect(saved.result.units).toBeGreaterThan(0)
    const read = async () =>
      (
        await dbClient.query(
          'SELECT project, last_modified_by FROM bng.projects WHERE id = $1',
          [projectId]
        )
      ).rows[0]
    const complete = await read()
    expect(complete.project.postIntervention.hedgerows[0]).toEqual(saved.result)
    expect(complete.project.postIntervention.units.hedgerowsTotal).toBe(
      saved.result.units
    )
    expect(complete.last_modified_by).toBe(userId)
    for (const invalid of [
      { advanceYears: 1, delayYears: 1 },
      { habitatType: 'Modified grassland' },
      { ref: ' ' },
      { broadType: 'Grassland' }
    ]) {
      const rejected = await server.inject({
        method: 'PUT',
        url,
        headers,
        payload: { ...payload, ...invalid }
      })
      expect(rejected.statusCode).toBe(HTTP_BAD_REQUEST)
      expect(await read()).toEqual(complete)
    }
    const partial = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, delayYears: null }
    })
    expect(partial.statusCode).toBe(HTTP_OK)
    expect(partial.result).toMatchObject({
      units: null,
      status: 'Incomplete',
      proposed: { delayYears: null }
    })
    expect((await read()).project.postIntervention.units.hedgerowsTotal).toBe(0)
  })
})

describe('BMD-1049 legacy timing and lineage', () => {
  it('preserves omitted imported timing and the original baseline parent across a rename', async () => {
    const parentId = randomUUID()
    const feature = {
      featureId: randomUUID(),
      ref: 'H-original',
      retentionCategory: 'Created',
      sizeMetres: 336,
      units: null,
      status: 'Incomplete',
      baseline: { type: 'Native hedgerow', condition: 'Poor' },
      proposed: {
        type: 'Native hedgerow',
        condition: 'Good',
        strategicSignificance: 'Low',
        advanceYears: 2.5,
        delayYears: 0
      }
    }
    const projectId = await seedProject({
      name: 'Legacy timing IT',
      baseline: {
        hedgerows: [
          {
            featureId: parentId,
            ref: 'H-original',
            type: 'Native hedgerow',
            condition: 'Poor'
          }
        ]
      },
      postIntervention: { hedgerows: [feature] }
    })
    const url = `/projects/${projectId}/post-intervention/hedgerows/${feature.featureId}`
    const payload = {
      ref: 'H-renamed',
      habitatType: 'Native hedgerow',
      condition: 'Good',
      strategicSignificance: 'Low',
      delayYears: 0
    }
    const saved = await server.inject({ method: 'PUT', url, headers, payload })
    expect(saved.statusCode).toBe(HTTP_OK)
    expect(saved.result).toMatchObject({
      ref: 'H-renamed',
      referenceEdited: true,
      parentFeatureId: parentId,
      proposed: { advanceYears: 2.5 }
    })
    const read = async () =>
      (
        await dbClient.query('SELECT project FROM bng.projects WHERE id = $1', [
          projectId
        ])
      ).rows[0].project
    expect((await read()).postIntervention.hedgerows[0]).toEqual(saved.result)
    const invalid = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, advanceYears: 2.5 }
    })
    expect(invalid.statusCode).toBe(HTTP_BAD_REQUEST)
    const cleared = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, advanceYears: null }
    })
    expect(cleared.statusCode).toBe(HTTP_OK)
    expect(
      (await read()).postIntervention.hedgerows[0].proposed.advanceYears
    ).toBeNull()
  })
})

describe('Created area imported timing preservation', () => {
  it('persists omitted fractional timing and clears it only on an explicit null', async () => {
    const feature = {
      featureId: randomUUID(),
      ref: 'A-imported',
      retentionCategory: 'Created',
      sizeSquareMetres: 25000,
      units: null,
      status: 'Incomplete',
      baseline: {},
      proposed: {
        broadType: 'Grassland',
        type: 'Modified grassland',
        condition: 'Good',
        strategicSignificance: 'Low',
        advanceYears: 2.5,
        delayYears: 0
      }
    }
    const projectId = await seedProject({
      name: 'Area imported timing IT',
      postIntervention: { habitats: [feature] }
    })
    const url = `/projects/${projectId}/post-intervention/habitats/${feature.featureId}`
    const payload = {
      ref: 'A-renamed',
      broadType: 'Grassland',
      habitatType: 'Modified grassland',
      condition: 'Good',
      strategicSignificance: 'Low'
    }
    const read = async () =>
      (
        await dbClient.query('SELECT project FROM bng.projects WHERE id = $1', [
          projectId
        ])
      ).rows[0].project.postIntervention.habitats[0]
    const saved = await server.inject({ method: 'PUT', url, headers, payload })
    expect(saved.statusCode).toBe(HTTP_OK)
    expect((await read()).proposed).toMatchObject({
      advanceYears: 2.5,
      delayYears: 0
    })
    const invalid = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, advanceYears: 2.5 }
    })
    expect(invalid.statusCode).toBe(HTTP_BAD_REQUEST)
    const cleared = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, advanceYears: null }
    })
    expect(cleared.statusCode).toBe(HTTP_OK)
    expect((await read()).proposed.advanceYears).toBeNull()
  })
})

describe('BMD-1050 Created watercourse saves', () => {
  // BMD-1175: a value saved before the service checked lists.
  it('refuses an edit with STORED_VALUE_NOT_ALLOWED, naming the field, and changes nothing', async () => {
    const feature = watercourse()
    Object.assign(feature.proposed, { condition: 'Imported condition' })
    const projectId = await seedProject({
      name: 'Stored value IT',
      postIntervention: { watercourses: [feature] }
    })
    const response = await server.inject({
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/watercourses/${feature.featureId}`,
      headers,
      payload: { ref: 'Renamed' }
    })
    expect(response.statusCode).toBe(422)
    expect(response.result.code).toBe('STORED_VALUE_NOT_ALLOWED')
    expect(response.result.message).toMatch(/proposed\.condition/)
  })

  it('preserves unsupported imports on rename, then persists deliberate clears and replacements', async () => {
    const feature = watercourse()
    Object.assign(feature.proposed, {
      type: 'Imported watercourse',
      // In a list, but not one the watercourse type offers: an import keeps
      // such a value. A value in no list is refused at upload (BMD-1175).
      condition: 'N/A - Other',
      strategicSignificance: null,
      rejectedStrategicSignificance: 'Medium',
      advanceYears: 2.5,
      watercourseEncroachment: 'N/A - Culvert'
    })
    const projectId = await seedProject({
      name: 'Imported values IT',
      postIntervention: { watercourses: [feature] }
    })
    const url = `/projects/${projectId}/post-intervention/watercourses/${feature.featureId}`
    const get = async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/projects/${projectId}/post-intervention/features/${feature.featureId}`,
        headers
      })
      expect(response.statusCode).toBe(HTTP_OK)
      return response.result.feature
    }
    const renamed = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ref: 'Renamed' }
    })
    expect(renamed.statusCode, renamed.payload).toBe(HTTP_OK)
    const stored = await get()
    expect(stored.ref).toBe('Renamed')
    expect(stored.proposed).toMatchObject({
      type: 'Imported watercourse',
      condition: 'N/A - Other',
      strategicSignificance: null,
      rejectedStrategicSignificance: 'Medium',
      advanceYears: 2.5,
      watercourseEncroachment: 'N/A - Culvert'
    })
    expect(stored.status).toBe('Incomplete')
    expect(stored.units).toBeNull()
    const cleared = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: {
        ref: 'Renamed',
        habitatType: null,
        condition: null,
        strategicSignificance: null,
        advanceYears: null,
        delayYears: null,
        watercourseEncroachment: null,
        riparianEncroachment: null
      }
    })
    expect(cleared.statusCode, cleared.payload).toBe(HTTP_OK)
    expect((await get()).proposed).toMatchObject({
      type: null,
      condition: null,
      strategicSignificance: null,
      rejectedStrategicSignificance: null,
      advanceYears: null,
      delayYears: null,
      watercourseEncroachment: null,
      riparianEncroachment: null
    })
    const replaced = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload
    })
    expect(replaced.statusCode, replaced.payload).toBe(HTTP_OK)
    const corrected = await get()
    expect(corrected.proposed.strategicSignificance).toBe(
      payload.strategicSignificance
    )
    expect(corrected.proposed.rejectedStrategicSignificance).toBeNull()
    expect(corrected.status).toBe('Complete')
    expect(corrected.units).toBeGreaterThan(0)
  })

  it.each(
    [10, '30+'].flatMap((advance) =>
      ['saved', 'imported', 'cleared', 'saved-delay', 'imported-delay'].map(
        (mode) => [advance, mode]
      )
    )
  )(
    'persists advance %s through a restricted %s rename and baseline correction',
    async (advanceYears, mode) => {
      const parent = {
        featureId: randomUUID(),
        ref: 'Parent',
        type: 'Ditches',
        condition: 'Moderate',
        sizeMetres: 500,
        strategicSignificance: 'Low',
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment'
      }
      const feature = {
        ...watercourse(),
        parentFeatureId: parent.featureId,
        properties: { 'Habitat created in advance/years': 5 }
      }
      if (!mode.startsWith('saved')) {
        feature.properties['Habitat created in advance/years'] = advanceYears
        feature.proposed.condition = 'Poor'
        feature.proposed.advanceYears = null
        feature.proposed.advanceYearsIs30Plus = advanceYears === '30+'
      }
      const projectId = await seedProject({
        name: 'Restricted advance rename IT',
        baseline: { watercourses: [parent] },
        postIntervention: {
          template: { name: 'bng-service', version: '1.0' },
          watercourses: [feature]
        }
      })
      const url = `/projects/${projectId}/post-intervention/watercourses/${feature.featureId}`
      const read = async () =>
        (
          await dbClient.query(
            'SELECT project FROM bng.projects WHERE id = $1',
            [projectId]
          )
        ).rows[0].project
      if (!mode.startsWith('saved')) {
        const imported = (await read()).postIntervention.watercourses[0]
        expect(imported).not.toHaveProperty('editedAdvanceYears')
        expect(imported.proposed.advanceYears).toBeNull()
      }
      if (mode.startsWith('saved')) {
        const saved = await server.inject({
          method: 'PUT',
          url,
          headers,
          payload: { ...payload, condition: 'Poor', advanceYears }
        })
        expect(saved.statusCode, saved.payload).toBe(HTTP_OK)
        expect(saved.result.proposed.advanceYears).toBeNull()
      }
      const { advanceYears: _advance, ...rename } = {
        ...payload,
        condition: 'Poor',
        ref: 'Renamed while restricted'
      }
      if (mode === 'cleared') {
        rename.advanceYears = null
      }
      const selectsDelay = mode.endsWith('-delay')
      if (selectsDelay) {
        rename.delayYears = '2'
      }
      const renamed = await server.inject({
        method: 'PUT',
        url,
        headers,
        payload: rename
      })
      expect(renamed.statusCode, renamed.payload).toBe(HTTP_OK)
      expect(renamed.result.proposed.advanceYears).toBeNull()
      expect(renamed.result.units).toBeNull()
      expect(renamed.result.status).toBe('Incomplete')
      const expectedAdvance =
        mode === 'cleared' || selectsDelay
          ? null
          : advanceYears === '30+'
            ? 30
            : advanceYears
      expect(
        (await read()).postIntervention.watercourses[0].editedAdvanceYears
      ).toBe(expectedAdvance)
      expect(
        (await read()).postIntervention.watercourses[0].properties
      ).toEqual(feature.properties)
      // The companion form omits an unchanged blank advance, rather than
      // sending null. Exercise a subsequent real form-shaped save as well.
      const { advanceYears: _cleared, ...unchangedBlank } = rename
      const renamedAgain = await server.inject({
        method: 'PUT',
        url,
        headers,
        payload: { ...unchangedBlank, delayYears: selectsDelay ? '2' : '0' }
      })
      expect(renamedAgain.statusCode, renamedAgain.payload).toBe(HTTP_OK)
      expect(renamedAgain.result.proposed.advanceYears).toBeNull()
      expect(
        (await read()).postIntervention.watercourses[0].editedAdvanceYears
      ).toBe(expectedAdvance)
      const corrected = await server.inject({
        method: 'PUT',
        url: `/projects/${projectId}/features/${parent.featureId}`,
        headers,
        payload: {
          habitatType: 'Ditches',
          condition: 'Poor',
          watercourseEncroachment: 'No Encroachment',
          riparianEncroachment: 'No Encroachment/No Encroachment'
        }
      })
      expect(corrected.statusCode, corrected.payload).toBe(HTTP_OK)
      expect((await read()).postIntervention.watercourses[0]).toMatchObject({
        ref: rename.ref,
        status: mode === 'cleared' || selectsDelay ? 'Incomplete' : 'Complete',
        editedAdvanceYears: expectedAdvance,
        proposed: {
          advanceYears: expectedAdvance,
          advanceYearsIs30Plus:
            mode !== 'cleared' && !selectsDelay && advanceYears === '30+',
          delayYears: selectsDelay ? 2 : 0
        }
      })
    }
  )
  it('persists lineage changes on both the edited watercourse and its sibling atomically', async () => {
    const parent = {
      featureId: randomUUID(),
      ref: 'Parent',
      type: 'Ditches',
      condition: 'Moderate',
      sizeMetres: 1000,
      watercourseEncroachment: 'No Encroachment',
      riparianEncroachment: 'No Encroachment/No Encroachment',
      strategicSignificance: 'Low'
    }
    const children = [watercourse(), watercourse()].map((child) => ({
      ...child,
      parentFeatureId: parent.featureId,
      editedAdvanceYears: 10,
      properties: { 'Habitat created in advance/years': 5 },
      proposed: {
        ...child.proposed,
        advanceYears: 10,
        watercourseEncroachment: 'Major'
      }
    }))
    const projectId = await seedProject({
      name: 'Template sibling persistence IT',
      baseline: { watercourses: [parent] },
      postIntervention: {
        template: { name: 'bng-service', version: '1.0' },
        watercourses: children
      }
    })
    const response = await server.inject({
      method: 'PUT',
      url: `/projects/${projectId}/post-intervention/watercourses/${children[0].featureId}`,
      headers,
      payload: {
        ...payload,
        habitatType: 'Canals',
        condition: 'Moderate',
        advanceYears: 10
      }
    })
    expect(response.statusCode).toBe(HTTP_OK)
    const { rows } = await dbClient.query(
      'SELECT project, last_modified_by FROM bng.projects WHERE id = $1',
      [projectId]
    )
    const document = rows[0].project.postIntervention
    expect(document.watercourses[0]).toEqual(response.result)
    for (const child of document.watercourses) {
      expect(child.proposed.advanceYears).toBeNull()
      expect(child.units).toBeNull()
      expect(child.status).toBe('Incomplete')
      expect(child.editedAdvanceYears).toBe(10)
    }
    expect(document.units.watercoursesTotal).toBe(0)
    expect(rows[0].last_modified_by).toBe(userId)
  })
  function watercourse() {
    return {
      featureId: randomUUID(),
      ref: 'W-original',
      retentionCategory: 'Created',
      sizeMetres: 500,
      units: null,
      status: 'Incomplete',
      baseline: {},
      proposed: {
        type: 'Ditches',
        condition: 'Moderate',
        strategicSignificance: 'Low',
        advanceYears: 0,
        delayYears: 0,
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment'
      }
    }
  }
  const payload = {
    ref: 'W-renamed',
    habitatType: 'Ditches',
    condition: 'Good',
    strategicSignificance: 'High',
    advanceYears: 0,
    delayYears: 0,
    watercourseEncroachment: 'Minor',
    riparianEncroachment: 'Minor/Minor'
  }

  it('persists the engine result, both encroachments and totals; clearing either input remains Incomplete after reload', async () => {
    const feature = watercourse()
    const projectId = await seedProject({
      name: 'Watercourse edit IT',
      postIntervention: { watercourses: [feature] }
    })
    const url = `/projects/${projectId}/post-intervention/watercourses/${feature.featureId}`
    const read = async () =>
      (
        await dbClient.query('SELECT project FROM bng.projects WHERE id = $1', [
          projectId
        ])
      ).rows[0].project
    const saved = await server.inject({ method: 'PUT', url, headers, payload })
    expect(saved.statusCode).toBe(HTTP_OK)
    const expected = calculateCreatedWatercoursePostIntervention(
      0.5,
      'Ditches',
      'Good',
      'Minor',
      'Minor/Minor',
      0,
      0,
      'High'
    )
    expect(saved.result.units).toBe(expected.units)
    expect(saved.result.proposed).toMatchObject({
      waterEncroachmentMultiplier: expected.waterEncroachmentMultiplier,
      riparianEncroachmentMultiplier: expected.riparianEncroachmentMultiplier
    })
    expect((await read()).postIntervention.watercourses[0]).toEqual(
      saved.result
    )
    expect((await read()).postIntervention.units.watercoursesTotal).toBeCloseTo(
      roundToSigFigs(expected.units)
    )
    for (const field of [
      'watercourseEncroachment',
      'riparianEncroachment',
      'delayYears'
    ]) {
      const cleared = await server.inject({
        method: 'PUT',
        url,
        headers,
        payload: { ...payload, [field]: null }
      })
      expect(cleared.statusCode).toBe(HTTP_OK)
      const document = (await read()).postIntervention
      expect(document.watercourses[0].proposed[field]).toBeNull()
      expect(document.watercourses[0].units).toBeNull()
      expect(document.watercourses[0].status).toBe('Incomplete')
      expect(document.units.watercoursesTotal).toBe(0)
    }
    const { delayYears: _delay, ...omitted } = payload
    expect(
      (await server.inject({ method: 'PUT', url, headers, payload: omitted }))
        .statusCode
    ).toBe(HTTP_OK)
    expect(
      (await read()).postIntervention.watercourses[0].proposed.delayYears
    ).toBeNull()
  })

  it('requires the owner and refuses invalid edits without modifying the stored feature', async () => {
    const feature = watercourse()
    const projectId = await seedProject({
      name: 'Watercourse validation IT',
      postIntervention: { watercourses: [feature] }
    })
    const url = `/projects/${projectId}/post-intervention/watercourses/${feature.featureId}`
    expect(
      (await server.inject({ method: 'PUT', url, payload })).statusCode
    ).toBe(HTTP_UNAUTHORIZED)
    const other = authHeaders(await mintToken({ sub: `other-${randomUUID()}` }))
    expect(
      (await server.inject({ method: 'PUT', url, headers: other, payload }))
        .statusCode
    ).toBe(HTTP_NOT_FOUND)
    for (const changes of [
      { ref: ' ' },
      { advanceYears: 1, delayYears: 2 },
      { habitatType: 'Native hedgerow' },
      { watercourseEncroachment: 'Unknown' },
      { riparianEncroachment: 'Minor' },
      { sizeMetres: 900 }
    ]) {
      expect(
        (
          await server.inject({
            method: 'PUT',
            url,
            headers,
            payload: { ...payload, ...changes }
          })
        ).statusCode
      ).toBe(HTTP_BAD_REQUEST)
    }
    const document = (
      await dbClient.query('SELECT project FROM bng.projects WHERE id = $1', [
        projectId
      ])
    ).rows[0].project
    expect(document.postIntervention.watercourses[0]).toEqual(feature)
  })

  it('normalises legacy retention and retains omitted imported condition and timing on a rename', async () => {
    const feature = watercourse()
    delete feature.retentionCategory
    feature.baseline.retentionCategory = 'Created'
    feature.proposed.type = 'Culvert'
    feature.proposed.condition = 'Good'
    feature.proposed.advanceYears = 2.5
    const projectId = await seedProject({
      name: 'Legacy watercourse IT',
      postIntervention: { watercourses: [feature] }
    })
    const url = `/projects/${projectId}/post-intervention/watercourses/${feature.featureId}`
    const payload = {
      ref: 'Renamed culvert',
      habitatType: 'Culvert',
      strategicSignificance: 'Low'
    }
    const saved = await server.inject({ method: 'PUT', url, headers, payload })
    expect(saved.statusCode).toBe(HTTP_OK)
    expect(saved.result.retentionCategory).toBe('Created')
    expect(saved.result.baseline).not.toHaveProperty('retentionCategory')
    expect(saved.result.proposed).toMatchObject({
      condition: 'Good',
      advanceYears: 2.5,
      watercourseEncroachment: 'No Encroachment',
      riparianEncroachment: 'No Encroachment/No Encroachment'
    })
    const reloaded = await server.inject({
      method: 'GET',
      url: `/projects/${projectId}/post-intervention/features/${feature.featureId}`,
      headers
    })
    expect(reloaded.statusCode).toBe(HTTP_OK)
    expect(reloaded.result.feature.proposed.condition).toBe('Good')
    const invalid = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, condition: 'Good' }
    })
    expect(invalid.statusCode).toBe(HTTP_BAD_REQUEST)
    const cleared = await server.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...payload, condition: null, advanceYears: null }
    })
    expect(cleared.statusCode).toBe(HTTP_OK)
    expect(cleared.result.proposed.condition).toBeNull()
    expect(cleared.result.proposed.advanceYears).toBeNull()
  })
})
