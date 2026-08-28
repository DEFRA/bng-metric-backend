import { beforeEach, describe, test, expect, vi } from 'vitest'

import { PG_LOCK_NOT_AVAILABLE } from '../db/postgres-error-codes.js'
import { setProjectFeature } from '../db/persist-project.js'
import {
  getFeature,
  getPostInterventionFeature,
  updateFeature
} from './features.js'

// The route persists surgically via setProjectFeature (a jsonb_set, not an
// inspectable object), so we mock it and assert the route handed it the right
// { documentKey, layer, index, feature, unitsTotals }. That helper's
// validation is covered by persist-project.test.js and end-to-end persistence
// by the integration tests.
vi.mock('../db/persist-project.js', () => ({
  setProjectFeature: vi.fn().mockResolvedValue(undefined)
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const AUTH = { credentials: { sub: 'test-user-001' } }

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const HABITAT_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
const HEDGEROW_ID = 'bb0e8400-e29b-41d4-a716-446655440002'
const WATERCOURSE_ID = 'cc0e8400-e29b-41d4-a716-446655440003'
const UNKNOWN_FEATURE_ID = 'dd0e8400-e29b-41d4-a716-446655440099'
const UNKNOWN_PROJECT_ID = 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'

const sampleHabitat = {
  featureId: HABITAT_ID,
  ref: '1',
  type: 'Modified grassland',
  broadType: 'Grassland',
  condition: 'Poor',
  sizeSquareMetres: 10_000,
  units: 4
}
const sampleHedgerow = {
  featureId: HEDGEROW_ID,
  ref: 'H1',
  type: null,
  condition: null,
  sizeMetres: 1000
}
const sampleWatercourse = {
  featureId: WATERCOURSE_ID,
  ref: 'W1',
  type: null,
  condition: null,
  watercourseEncroachment: null,
  riparianEncroachment: null,
  sizeMetres: 1000
}

function makeProject(habitats = [sampleHabitat]) {
  return {
    id: PROJECT_ID,
    project: {
      name: 'Test Project',
      baseline: {
        habitats,
        hedgerows: [sampleHedgerow],
        watercourses: [sampleWatercourse],
        units: {
          totalUnits: 4,
          habitatsTotal: 4,
          hedgerowsTotal: 0,
          watercoursesTotal: 0
        }
      }
    },
    userId: 'test-user-001',
    bngProjectVersion: 1
  }
}

const projectWithPostIntervention = {
  id: PROJECT_ID,
  project: {
    postIntervention: {
      habitats: [sampleHabitat],
      hedgerows: [sampleHedgerow],
      watercourses: []
    }
  }
}

// The handlers now ask Postgres for the matching feature in each layer instead
// of the whole document, so the stub returns the row that projection yields:
// one column per layer, null where that layer holds no match. Mirrors
// featureByIdColumns in src/db/project-features.js.
const LAYER_KEYS = ['habitats', 'trees', 'hedgerows', 'watercourses']

function featureRow(projectRow, featureId, documentKey = 'baseline') {
  const featureSet = projectRow.project?.[documentKey] ?? {}
  const row = { id: projectRow.id }
  for (const key of LAYER_KEYS) {
    row[key] = featureSet[key]?.find((f) => f?.featureId === featureId) ?? null
  }
  return row
}

function getFeatureMockDrizzle(rows) {
  const chain = {
    where: vi.fn().mockResolvedValue(rows)
  }
  chain.from = vi.fn().mockReturnValue({ where: chain.where })
  return { select: vi.fn().mockReturnValue(chain) }
}

function projectLookupChain(rows, lockError) {
  const result = lockError ? Promise.reject(lockError) : Promise.resolve(rows)
  const limitStep = { limit: () => result }
  const forStep = { for: () => limitStep }
  const whereStep = { where: () => forStep }
  return { from: () => whereStep }
}

function makeTxDrizzle(projectRow, { lockError = null } = {}) {
  const set = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined)
  })
  const execute = vi.fn().mockResolvedValue(undefined)
  const tx = {
    execute,
    select: vi.fn(() =>
      projectLookupChain(projectRow ? [projectRow] : [], lockError)
    ),
    update: vi.fn().mockReturnValue({ set })
  }
  return {
    transaction: vi.fn((cb) => cb(tx)),
    _tx: tx,
    _updateSet: set
  }
}

describe('#getFeature', () => {
  test('returns { type, feature } for a habitat', async () => {
    const drizzle = getFeatureMockDrizzle([
      featureRow(makeProject(), HABITAT_ID)
    ])
    const request = {
      drizzle,
      auth: AUTH,
      params: { projectId: PROJECT_ID, featureId: HABITAT_ID }
    }
    const result = await getFeature.handler(request, {})
    expect(result).toEqual({ type: 'habitat', feature: sampleHabitat })
  })

  test('returns { type, feature } for a hedgerow', async () => {
    const drizzle = getFeatureMockDrizzle([
      featureRow(makeProject(), HEDGEROW_ID)
    ])
    const request = {
      drizzle,
      auth: AUTH,
      params: { projectId: PROJECT_ID, featureId: HEDGEROW_ID }
    }
    const result = await getFeature.handler(request, {})
    expect(result).toEqual({ type: 'hedgerow', feature: sampleHedgerow })
  })

  test('throws 404 when the project is missing', async () => {
    const drizzle = getFeatureMockDrizzle([])
    const request = {
      drizzle,
      auth: AUTH,
      params: { projectId: UNKNOWN_PROJECT_ID, featureId: HABITAT_ID }
    }
    await expect(getFeature.handler(request, {})).rejects.toThrow(
      `Project ${UNKNOWN_PROJECT_ID} not found`
    )
  })

  test('throws 404 when the feature is absent from every layer', async () => {
    const drizzle = getFeatureMockDrizzle([
      featureRow(makeProject(), UNKNOWN_FEATURE_ID)
    ])
    const request = {
      drizzle,
      auth: AUTH,
      params: { projectId: PROJECT_ID, featureId: UNKNOWN_FEATURE_ID }
    }
    await expect(getFeature.handler(request, {})).rejects.toThrow(
      `Feature ${UNKNOWN_FEATURE_ID} not found in project ${PROJECT_ID}`
    )
  })

  test('throws 404 when the project has no baseline', async () => {
    const drizzle = getFeatureMockDrizzle([
      featureRow(
        { id: PROJECT_ID, project: { name: 'No baseline yet' } },
        HABITAT_ID
      )
    ])
    const request = {
      drizzle,
      auth: AUTH,
      params: { projectId: PROJECT_ID, featureId: HABITAT_ID }
    }
    await expect(getFeature.handler(request, {})).rejects.toThrow(
      `Feature ${HABITAT_ID} not found in project ${PROJECT_ID}`
    )
  })
})

describe('#getPostInterventionFeature', () => {
  test('returns { type, feature } from postIntervention', async () => {
    const drizzle = getFeatureMockDrizzle([
      featureRow(projectWithPostIntervention, HEDGEROW_ID, 'postIntervention')
    ])
    const request = {
      drizzle,
      auth: AUTH,
      params: { projectId: PROJECT_ID, featureId: HEDGEROW_ID }
    }
    const result = await getPostInterventionFeature.handler(request, {})
    expect(result).toEqual({ type: 'hedgerow', feature: sampleHedgerow })
  })

  test('throws 404 when the project has no postIntervention data', async () => {
    const drizzle = getFeatureMockDrizzle([
      featureRow(makeProject(), HABITAT_ID, 'postIntervention')
    ])
    const request = {
      drizzle,
      auth: AUTH,
      params: { projectId: PROJECT_ID, featureId: HABITAT_ID }
    }
    await expect(
      getPostInterventionFeature.handler(request, {})
    ).rejects.toThrow(
      `Feature ${HABITAT_ID} not found in project ${PROJECT_ID}`
    )
  })
})

describe('#getFeature validation', () => {
  const paramsSchema = getFeature.options.validate.params

  test('passes with two UUID params', () => {
    const { error } = paramsSchema.validate({
      projectId: PROJECT_ID,
      featureId: HABITAT_ID
    })
    expect(error).toBeUndefined()
  })

  test('fails when projectId is not a UUID', () => {
    const { error } = paramsSchema.validate({
      projectId: 'not-a-uuid',
      featureId: HABITAT_ID
    })
    expect(error).toBeDefined()
  })

  test('fails when featureId is not a UUID', () => {
    const { error } = paramsSchema.validate({
      projectId: PROJECT_ID,
      featureId: 'not-a-uuid'
    })
    expect(error).toBeDefined()
  })
})

describe('updateFeature route shape', () => {
  test('is a PUT at /projects/{projectId}/features/{featureId}', () => {
    expect(updateFeature.method).toBe('PUT')
    expect(updateFeature.path).toBe(
      '/projects/{projectId}/features/{featureId}'
    )
  })
})

describe('updateFeature handler - area habitat dispatch', () => {
  test('recomputes the area habitat and returns { type: "habitat", feature }', async () => {
    const drizzle = makeTxDrizzle(makeProject())
    const result = await updateFeature.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_ID },
        payload: {
          broadType: 'Grassland',
          habitatType: 'Other neutral grassland',
          condition: 'Good'
        }
      },
      {}
    )
    expect(result.type).toBe('habitat')
    expect(result.feature).toMatchObject({
      featureId: HABITAT_ID,
      broadType: 'Grassland',
      type: 'Other neutral grassland',
      condition: 'Good',
      distinctiveness: 'Medium',
      distinctivenessScore: 4,
      conditionScore: 3,
      units: 12,
      status: 'Complete'
    })
  })

  test('refreshes baseline.units totals after an area edit', async () => {
    const projectRow = makeProject()
    const drizzle = makeTxDrizzle(projectRow)

    await updateFeature.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_ID },
        payload: {
          broadType: 'Grassland',
          habitatType: 'Other neutral grassland',
          condition: 'Good'
        }
      },
      {}
    )

    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({
        documentKey: 'baseline',
        actorId: AUTH.credentials.sub,
        layer: 'habitats',
        unitsTotals: expect.objectContaining({
          habitatsTotal: 12,
          hedgerowsTotal: 0,
          totalUnits: 12
        })
      })
    )
  })
})

describe('updateFeature handler - hedgerow dispatch', () => {
  test('returns { type: "hedgerow", feature } and persists hedgerow shape', async () => {
    const projectRow = makeProject()
    const drizzle = makeTxDrizzle(projectRow)

    const result = await updateFeature.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HEDGEROW_ID },
        payload: {
          habitatType: 'Native hedgerow',
          condition: 'Good'
        }
      },
      {}
    )

    expect(result.type).toBe('hedgerow')
    expect(result.feature).toMatchObject({
      featureId: HEDGEROW_ID,
      type: 'Native hedgerow',
      condition: 'Good',
      distinctiveness: 'Low',
      conditionScore: 3,
      status: 'Complete',
      units: 6
    })
  })

  test('refreshes baseline.units totals after a hedgerow edit', async () => {
    const projectRow = makeProject()
    const drizzle = makeTxDrizzle(projectRow)

    await updateFeature.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HEDGEROW_ID },
        payload: { habitatType: 'Native hedgerow', condition: 'Good' }
      },
      {}
    )

    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({
        documentKey: 'baseline',
        actorId: AUTH.credentials.sub,
        layer: 'hedgerows',
        unitsTotals: expect.objectContaining({
          habitatsTotal: 4,
          hedgerowsTotal: 6
        })
      })
    )
  })
})

describe('updateFeature handler - error cases', () => {
  test('throws 404 when the project does not exist', async () => {
    const drizzle = makeTxDrizzle(null)
    await expect(
      updateFeature.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: UNKNOWN_PROJECT_ID, featureId: HABITAT_ID },
          payload: { habitatType: 'Native hedgerow', condition: 'Good' }
        },
        {}
      )
    ).rejects.toThrow(/Project .* not found/)
  })

  test('throws 404 when the feature is missing from every layer', async () => {
    const drizzle = makeTxDrizzle(makeProject())
    await expect(
      updateFeature.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: PROJECT_ID, featureId: UNKNOWN_FEATURE_ID },
          payload: { habitatType: 'Native hedgerow', condition: 'Good' }
        },
        {}
      )
    ).rejects.toThrow(/Feature .* not found/)
  })

  test('saves a watercourse edit with its encroachment fields and recomputed units', async () => {
    const drizzle = makeTxDrizzle(makeProject())
    const result = await updateFeature.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: WATERCOURSE_ID },
        payload: {
          habitatType: 'Ditches',
          condition: 'Moderate',
          watercourseEncroachment: 'Minor',
          riparianEncroachment: 'Minor/Minor'
        }
      },
      {}
    )

    expect(result.type).toBe('watercourse')
    // Medium (4) × Moderate (2) × 1 km × 0.8 × 0.95 = 6.08
    expect(result.feature).toMatchObject({
      featureId: WATERCOURSE_ID,
      type: 'Ditches',
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
      distinctiveness: 'Medium',
      status: 'Complete',
      units: 6.08
    })
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({
        actorId: AUTH.credentials.sub,
        layer: 'watercourses',
        unitsTotals: expect.objectContaining({ watercoursesTotal: 6.08 })
      })
    )
  })

  test('saves zero units and Incomplete status when a watercourse encroachment is unselected', async () => {
    const drizzle = makeTxDrizzle(makeProject())
    const result = await updateFeature.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: WATERCOURSE_ID },
        payload: {
          habitatType: 'Ditches',
          condition: 'Moderate',
          watercourseEncroachment: '',
          riparianEncroachment: ''
        }
      },
      {}
    )

    expect(result.feature).toMatchObject({
      type: 'Ditches',
      status: 'Incomplete',
      units: 0
    })
  })

  test('rejects an out-of-scope (High/V.High) habitat type with 422', async () => {
    const drizzle = makeTxDrizzle(makeProject())
    await expect(
      updateFeature.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: PROJECT_ID, featureId: HABITAT_ID },
          payload: {
            broadType: 'Grassland',
            habitatType: 'Lowland meadows',
            condition: 'Good'
          }
        },
        {}
      )
    ).rejects.toMatchObject({
      isBoom: true,
      output: {
        statusCode: 422,
        payload: { code: 'HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE' }
      }
    })
    // Nothing is persisted when the edit is rejected.
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('throws 409 when SELECT ... FOR UPDATE times out on a concurrent edit', async () => {
    const lockError = Object.assign(new Error('lock_not_available'), {
      code: PG_LOCK_NOT_AVAILABLE
    })
    const drizzle = makeTxDrizzle(makeProject(), { lockError })
    await expect(
      updateFeature.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: PROJECT_ID, featureId: HABITAT_ID },
          payload: { habitatType: 'Lowland meadows', condition: 'Good' }
        },
        {}
      )
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 409 }
    })
  })
})

describe('updateFeature validation', () => {
  const paramsSchema = updateFeature.options.validate.params
  const payloadSchema = updateFeature.options.validate.payload

  test('requires UUID projectId and featureId', () => {
    expect(
      paramsSchema.validate({ projectId: PROJECT_ID, featureId: HABITAT_ID })
        .error
    ).toBeUndefined()
    expect(
      paramsSchema.validate({ projectId: 'nope', featureId: HABITAT_ID }).error
    ).toBeDefined()
  })

  test('accepts a payload with hedgerow shape (no broadType)', () => {
    expect(
      payloadSchema.validate({
        habitatType: 'Native hedgerow',
        condition: 'Good'
      }).error
    ).toBeUndefined()
  })

  test('accepts a payload with area shape (broadType + habitatType + condition)', () => {
    expect(
      payloadSchema.validate({
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }).error
    ).toBeUndefined()
  })

  test('accepts a payload of all nulls and an empty payload (deselected)', () => {
    expect(
      payloadSchema.validate({
        broadType: null,
        habitatType: null,
        condition: null
      }).error
    ).toBeUndefined()
    expect(payloadSchema.validate({}).error).toBeUndefined()
  })

  test('accepts a payload with watercourse encroachment fields', () => {
    expect(
      payloadSchema.validate({
        habitatType: 'Ditches',
        condition: 'Good',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/Minor'
      }).error
    ).toBeUndefined()
  })

  test('rejects unknown keys to stop the frontend silently leaking new fields', () => {
    expect(
      payloadSchema.validate({
        habitatType: 'Ditches',
        somethingNew: 'value'
      }).error
    ).toBeDefined()
  })
})
