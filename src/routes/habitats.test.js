import { beforeEach, describe, test, expect, vi } from 'vitest'

import { setProjectFeature } from '../db/persist-project.js'
import {
  updateAreaHabitat,
  updatePostInterventionAreaHabitat
} from './habitats.js'

// The route persists surgically via setProjectFeature (a jsonb_set, not an
// inspectable object), so we mock it and assert the route computed the right
// { documentKey, layer, index, feature, unitsTotals } to write. That helper's
// validation is covered by persist-project.test.js; the totals maths by
// apply-feature-update.test.js; end-to-end persistence by the integration tests.
vi.mock('../db/persist-project.js', () => ({
  setProjectFeature: vi.fn().mockResolvedValue(undefined)
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const AUTH = { credentials: { sub: 'test-user-001' } }

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const UNKNOWN_PROJECT_ID = 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'
const HABITAT_1_ID = '11111111-2222-3333-4444-555555555555'
const HABITAT_2_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa'
const UNKNOWN_HABITAT_ID = 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb'

function makeProjectRow(habitats, documentKey = 'baseline') {
  return {
    id: PROJECT_ID,
    project: {
      name: 'Test Project',
      [documentKey]: { habitats }
    },
    userId: 'test-user-001',
    bngProjectVersion: 1
  }
}

function defaultHabitats() {
  return [
    {
      featureId: HABITAT_1_ID,
      ref: 'A1',
      type: 'Modified grassland',
      broadType: 'Grassland',
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      condition: 'Poor',
      sizeSquareMetres: 10_000
    },
    {
      featureId: HABITAT_2_ID,
      ref: 'A2',
      type: 'Cereal crops',
      broadType: 'Cropland',
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      condition: 'Condition Assessment N/A',
      sizeSquareMetres: 5000
    }
  ]
}

function defaultPostInterventionHabitats() {
  return [
    {
      featureId: HABITAT_1_ID,
      ref: 'A1',
      area: 10_000,
      sizeSquareMetres: 10_000,
      units: null,
      status: 'Incomplete',
      baseline: {
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Poor',
        conditionScore: null,
        distinctiveness: null,
        distinctivenessScore: null
      },
      proposed: {
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Poor',
        conditionScore: null,
        distinctiveness: null,
        distinctivenessScore: null,
        advanceYears: 0,
        delayYears: 0
      }
    },
    {
      featureId: HABITAT_2_ID,
      ref: 'A2',
      area: 5000,
      sizeSquareMetres: 5000,
      units: null,
      status: 'Incomplete',
      baseline: {
        type: 'Cereal crops',
        broadType: 'Cropland',
        condition: 'Condition Assessment N/A',
        conditionScore: null,
        distinctiveness: null,
        distinctivenessScore: null
      },
      proposed: {
        type: 'Cereal crops',
        broadType: 'Cropland',
        condition: 'Condition Assessment N/A',
        conditionScore: null,
        distinctiveness: null,
        distinctivenessScore: null,
        advanceYears: 0,
        delayYears: 0
      }
    }
  ]
}

// Mirrors the drizzle .select().from().where().for('update').limit() chain the
// route uses to read the project row under a transaction-scoped row lock.
// `lockError` simulates the 55P03 the driver raises when SET LOCAL lock_timeout
// fires while another transaction is mid-edit.
function projectLookupChain(rows, lockError) {
  const result = lockError ? Promise.reject(lockError) : Promise.resolve(rows)
  const limitStep = { limit: () => result }
  const forStep = { for: () => limitStep }
  const whereStep = { where: () => forStep }
  return { from: () => whereStep }
}

function makeDrizzle(projectRow, { lockError = null } = {}) {
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
    _updateSet: set,
    _execute: execute
  }
}

describe('updateAreaHabitat route shape', () => {
  test('is a PUT at /projects/{projectId}/habitats/{featureId}', () => {
    expect(updateAreaHabitat.method).toBe('PUT')
    expect(updateAreaHabitat.path).toBe(
      '/projects/{projectId}/habitats/{featureId}'
    )
  })
})

describe('updatePostInterventionAreaHabitat route shape', () => {
  test('is a PUT at /projects/{projectId}/post-intervention/habitats/{featureId}', () => {
    expect(updatePostInterventionAreaHabitat.method).toBe('PUT')
    expect(updatePostInterventionAreaHabitat.path).toBe(
      '/projects/{projectId}/post-intervention/habitats/{featureId}'
    )
  })
})

describe('updateAreaHabitat handler — happy path', () => {
  test('recomputes derived fields and persists the updated habitat', async () => {
    const habitats = defaultHabitats()
    const projectRow = makeProjectRow(habitats)
    const drizzle = makeDrizzle(projectRow)

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
        payload: {
          broadType: 'Grassland',
          habitatType: 'Lowland meadows',
          condition: 'Good'
        }
      },
      {}
    )

    expect(result).toMatchObject({
      featureId: HABITAT_1_ID,
      broadType: 'Grassland',
      type: 'Lowland meadows',
      condition: 'Good',
      distinctiveness: 'V.High',
      distinctivenessScore: 8,
      conditionScore: 3,
      // 1 ha × 8 × 3 = 24
      units: 24,
      status: 'Complete'
    })

    // Persisted surgically: only the edited feature (by layer + index) and the
    // refreshed totals are handed to the choke point — the rest of the document
    // is left untouched in the DB.
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({
        documentKey: 'baseline',
        layer: 'habitats',
        index: 0,
        feature: expect.objectContaining({ featureId: HABITAT_1_ID, units: 24 })
      })
    )
  })

  test('marks the habitat Incomplete with zero units when a dropdown is unset', async () => {
    const habitats = defaultHabitats()
    const drizzle = makeDrizzle(makeProjectRow(habitats))

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
        payload: {
          broadType: 'Grassland',
          habitatType: 'Lowland meadows',
          condition: null
        }
      },
      {}
    )

    expect(result).toMatchObject({
      broadType: 'Grassland',
      type: 'Lowland meadows',
      condition: null,
      distinctiveness: 'V.High',
      distinctivenessScore: 8,
      conditionScore: null,
      units: 0,
      status: 'Incomplete'
    })
  })

  test('treats empty strings as deselected (Incomplete + zero units)', async () => {
    const habitats = defaultHabitats()
    const drizzle = makeDrizzle(makeProjectRow(habitats))

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
        payload: { broadType: '', habitatType: '', condition: '' }
      },
      {}
    )

    expect(result).toMatchObject({
      broadType: null,
      type: null,
      condition: null,
      distinctiveness: null,
      distinctivenessScore: null,
      conditionScore: null,
      units: 0,
      status: 'Incomplete'
    })
  })

  test('refreshes baseline.units totals so the habitat-list summary stays in sync', async () => {
    const habitats = [
      {
        featureId: HABITAT_1_ID,
        ref: 'A1',
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Poor',
        sizeSquareMetres: 10_000,
        units: 4
      },
      {
        featureId: HABITAT_2_ID,
        ref: 'A2',
        type: 'Cereal crops',
        broadType: 'Cropland',
        condition: 'Condition Assessment N/A',
        sizeSquareMetres: 10_000,
        units: 2
      }
    ]
    const projectRow = makeProjectRow(habitats)
    projectRow.project.baseline.hedgerows = []
    projectRow.project.baseline.watercourses = []
    projectRow.project.baseline.units = {
      totalUnits: 6,
      habitatsTotal: 6,
      hedgerowsTotal: 0,
      watercoursesTotal: 0
    }
    const drizzle = makeDrizzle(projectRow)

    await updateAreaHabitat.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
        payload: {
          broadType: 'Grassland',
          habitatType: 'Lowland meadows',
          condition: 'Good'
        }
      },
      {}
    )

    // Edited habitat: 1 ha × V.High (8) × Good (3) = 24, so habitatsTotal
    // should be 24 + 2 (the unchanged Cereal crops row) = 26. These refreshed
    // totals are written surgically alongside the feature.
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({
        documentKey: 'baseline',
        unitsTotals: {
          totalUnits: 26,
          habitatsTotal: 26,
          hedgerowsTotal: 0,
          watercoursesTotal: 0,
          treesTotal: 0,
          treesUrbanTotal: 0,
          treesRuralTotal: 0
        }
      })
    )
  })

  test('preserves area, ref and other non-dropdown fields', async () => {
    const habitats = defaultHabitats()
    const drizzle = makeDrizzle(makeProjectRow(habitats))

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
        payload: {
          broadType: 'Grassland',
          habitatType: 'Lowland meadows',
          condition: 'Good'
        }
      },
      {}
    )

    expect(result.ref).toBe('A1')
    expect(result.sizeSquareMetres).toBe(10_000)
  })
})

describe('updatePostInterventionAreaHabitat handler', () => {
  test('persists edits into the proposed sub-object of project.postIntervention', async () => {
    const habitats = defaultPostInterventionHabitats()
    const projectRow = makeProjectRow(habitats, 'postIntervention')
    const drizzle = makeDrizzle(projectRow)

    const result = await updatePostInterventionAreaHabitat.handler(
      {
        drizzle,
        auth: AUTH,
        params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
        payload: {
          broadType: 'Grassland',
          habitatType: 'Lowland meadows',
          condition: 'Good'
        }
      },
      {}
    )

    // Edits are written to the proposed sub-object, not top-level fields
    expect(result).toMatchObject({
      featureId: HABITAT_1_ID,
      proposed: expect.objectContaining({
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: 'Good'
      }),
      status: 'Complete'
    })
    // top-level type/condition should NOT be set on post-intervention features
    expect(result).not.toHaveProperty('type')
    expect(result).not.toHaveProperty('condition')

    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({
        documentKey: 'postIntervention',
        layer: 'habitats',
        index: 0,
        feature: expect.objectContaining({ featureId: HABITAT_1_ID })
      })
    )
  })
})

describe('updateAreaHabitat handler error cases', () => {
  test('throws 404 when the project does not exist', async () => {
    const drizzle = makeDrizzle(null)

    await expect(
      updateAreaHabitat.handler(
        {
          drizzle,
          auth: AUTH,
          params: {
            projectId: UNKNOWN_PROJECT_ID,
            featureId: HABITAT_1_ID
          },
          payload: {
            broadType: 'Grassland',
            habitatType: 'Lowland meadows',
            condition: 'Good'
          }
        },
        {}
      )
    ).rejects.toThrow(/Project .* not found/)
  })

  test('throws 404 when the habitat is not in the project', async () => {
    const drizzle = makeDrizzle(makeProjectRow(defaultHabitats()))

    await expect(
      updateAreaHabitat.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: PROJECT_ID, featureId: UNKNOWN_HABITAT_ID },
          payload: {
            broadType: 'Grassland',
            habitatType: 'Lowland meadows',
            condition: 'Good'
          }
        },
        {}
      )
    ).rejects.toThrow(/Habitat .* not found/)
  })

  test('throws 404 when the featureId belongs to a hedgerow (legacy area URL only serves habitats)', async () => {
    const hedgerowOnlyProject = {
      id: PROJECT_ID,
      project: {
        name: 'Test Project',
        baseline: {
          habitats: [],
          hedgerows: [
            {
              featureId: HABITAT_1_ID,
              ref: 'H1',
              type: 'Native hedgerow',
              sizeMetres: 200
            }
          ]
        }
      },
      userId: 'test-user-001',
      bngProjectVersion: 1
    }
    const drizzle = makeDrizzle(hedgerowOnlyProject)

    await expect(
      updateAreaHabitat.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
          payload: {
            broadType: 'Grassland',
            habitatType: 'Lowland meadows',
            condition: 'Good'
          }
        },
        {}
      )
    ).rejects.toThrow(/Habitat .* not found/)
  })

  test('throws 409 when SELECT ... FOR UPDATE times out on a concurrent edit', async () => {
    const lockError = Object.assign(new Error('lock_not_available'), {
      code: '55P03'
    })
    const drizzle = makeDrizzle(makeProjectRow(defaultHabitats()), {
      lockError
    })

    await expect(
      updateAreaHabitat.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
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
      output: { statusCode: 409 }
    })
  })

  test('throws 404 when the project has no baseline yet', async () => {
    const drizzle = makeDrizzle({
      id: PROJECT_ID,
      project: { name: 'Bare project' },
      userId: 'u',
      bngProjectVersion: 1
    })

    await expect(
      updateAreaHabitat.handler(
        {
          drizzle,
          auth: AUTH,
          params: { projectId: PROJECT_ID, featureId: HABITAT_1_ID },
          payload: { broadType: null, habitatType: null, condition: null }
        },
        {}
      )
    ).rejects.toThrow(/Habitat .* not found/)
  })
})

describe('updateAreaHabitat validation', () => {
  const paramsSchema = updateAreaHabitat.options.validate.params
  const payloadSchema = updateAreaHabitat.options.validate.payload

  test('requires UUID projectId and featureId', () => {
    expect(
      paramsSchema.validate({ projectId: PROJECT_ID, featureId: HABITAT_1_ID })
        .error
    ).toBeUndefined()
    expect(
      paramsSchema.validate({ projectId: 'nope', featureId: HABITAT_1_ID })
        .error?.message
    ).toContain('"projectId" must be a valid GUID')
    expect(
      paramsSchema.validate({ projectId: PROJECT_ID, featureId: 'nope' }).error
        ?.message
    ).toContain('"featureId" must be a valid GUID')
  })

  test('accepts a payload with all three dropdown values populated', () => {
    expect(
      payloadSchema.validate({
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }).error
    ).toBeUndefined()
  })

  test('accepts a payload with nulls (deselected dropdowns)', () => {
    expect(
      payloadSchema.validate({
        broadType: null,
        habitatType: null,
        condition: null
      }).error
    ).toBeUndefined()
  })

  test('accepts a payload with empty strings (deselected dropdowns)', () => {
    expect(
      payloadSchema.validate({ broadType: '', habitatType: '', condition: '' })
        .error
    ).toBeUndefined()
  })

  test('accepts an empty payload (all fields optional, treated as deselected)', () => {
    expect(payloadSchema.validate({}).error).toBeUndefined()
  })
})
