import { describe, test, expect, vi } from 'vitest'
import { updateAreaHabitat } from './habitats.js'

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const UNKNOWN_PROJECT_ID = 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'
const HABITAT_1_ID = '11111111-2222-3333-4444-555555555555'
const HABITAT_2_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa'
const UNKNOWN_HABITAT_ID = 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb'

function makeProjectRow(habitats) {
  return {
    id: PROJECT_ID,
    project: {
      name: 'Test Project',
      baseline: { habitats }
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

function makeDrizzle(projectRow, { updateReturning = projectRow } = {}) {
  const selectChain = {
    where: vi.fn().mockResolvedValue(projectRow ? [projectRow] : [])
  }
  selectChain.from = vi.fn().mockReturnValue({ where: selectChain.where })

  const returning = vi
    .fn()
    .mockResolvedValue(updateReturning ? [updateReturning] : [])
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })

  return {
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue({ set }),
    _selectWhere: selectChain.where,
    _updateSet: set,
    _updateWhere: where,
    _updateReturning: returning
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

describe('updateAreaHabitat handler — happy path', () => {
  test('recomputes derived fields and persists the updated habitat', async () => {
    const habitats = defaultHabitats()
    const projectRow = makeProjectRow(habitats)
    const drizzle = makeDrizzle(projectRow)

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
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
      habitatUnits: 24,
      status: 'Complete'
    })

    // The other habitat in the array must be unchanged.
    const persistedProject = drizzle._updateSet.mock.calls[0][0].project
    expect(persistedProject.baseline.habitats[1]).toEqual(habitats[1])

    // The whole project document must be persisted (existing top-level fields
    // preserved).
    expect(persistedProject.name).toBe('Test Project')
  })

  test('marks the habitat Incomplete with zero units when a dropdown is unset', async () => {
    const habitats = defaultHabitats()
    const drizzle = makeDrizzle(makeProjectRow(habitats))

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
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
      habitatUnits: 0,
      status: 'Incomplete'
    })
  })

  test('treats empty strings as deselected (Incomplete + zero units)', async () => {
    const habitats = defaultHabitats()
    const drizzle = makeDrizzle(makeProjectRow(habitats))

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
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
      habitatUnits: 0,
      status: 'Incomplete'
    })
  })

  test('preserves area, ref and other non-dropdown fields', async () => {
    const habitats = defaultHabitats()
    const drizzle = makeDrizzle(makeProjectRow(habitats))

    const result = await updateAreaHabitat.handler(
      {
        drizzle,
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

describe('updateAreaHabitat handler — error cases', () => {
  test('throws 404 when the project does not exist', async () => {
    const drizzle = makeDrizzle(null)

    await expect(
      updateAreaHabitat.handler(
        {
          drizzle,
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
