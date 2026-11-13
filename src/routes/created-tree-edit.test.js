import { describe, test, expect, vi, beforeEach } from 'vitest'

import { getTreeCreationReference } from '../validation/reference/area-creation.js'
import { validateCreatedTreeEdit } from './created-tree-edit.js'
import { updatePostInterventionTree } from './habitats.js'
import { getTreeCreation } from './reference.js'
import { setProjectFeature } from '../db/persist-project.js'
import { ERROR_CODES } from '../validation/geopackage/errors.js'

vi.mock('../db/persist-project.js', () => ({
  setProjectFeature: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../db/feature-geometry-refs.js', () => ({
  setGeometryRefs: vi.fn().mockResolvedValue(undefined)
}))

const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

// A Small rural tree newly planted: 41 m².
const tree = {
  featureId,
  ref: 'T026',
  retentionCategory: 'Created',
  count: 1,
  sizeSquareMetres: 41,
  area: 41,
  units: 0.01,
  status: 'Complete',
  baseline: {},
  proposed: {
    broadType: 'Individual trees',
    type: 'Rural tree',
    treeSize: 'Small',
    condition: 'Poor',
    strategicSignificance: 'Low',
    advanceYears: 0,
    delayYears: 0
  },
  properties: {}
}

const edits = {
  ref: 'T026',
  broadType: 'Individual trees',
  habitatType: 'Urban tree',
  condition: 'Moderate',
  strategicSignificance: 'Low',
  advanceYears: 0,
  delayYears: 0
}

function routeRequest(payload, stored = tree, layer = 'trees') {
  const row = {
    project: {
      postIntervention: {
        habitats: [],
        trees: [],
        hedgerows: [],
        watercourses: [],
        [layer]: [stored]
      }
    }
  }
  const tx = {
    execute: vi.fn(),
    select: () => ({
      from: () => ({
        where: () => ({ for: () => ({ limit: async () => [row] }) })
      })
    })
  }
  return {
    params: { projectId, featureId },
    payload,
    auth: { credentials: { sub: 'test-user' } },
    drizzle: { transaction: (fn) => fn(tx) }
  }
}

function put(payload, stored) {
  return updatePostInterventionTree.handler(routeRequest(payload, stored), {})
}

describe('Created tree reference', () => {
  test('offers only Urban tree and Rural tree, in Individual trees', () => {
    const reference = getTreeCreationReference()

    expect(reference.habitatTypes.map((t) => [t.broad, t.name])).toEqual([
      ['Individual trees', 'Rural tree'],
      ['Individual trees', 'Urban tree']
    ])
    expect(reference.strategicSignificance.length).toBeGreaterThan(0)
    expect(reference.timeMultipliers).toBeDefined()
  })

  test('leaves out the target conditions a tree cannot be created to', () => {
    for (const type of getTreeCreationReference().habitatTypes) {
      expect(type.conditions.map((c) => c.condition)).toEqual([
        'Good',
        'Fairly Good',
        'Moderate',
        'Fairly Poor',
        'Poor'
      ])
    }
  })

  test('is served at /reference/tree-creation', () => {
    expect(getTreeCreation.path).toBe('/reference/tree-creation')
    expect(getTreeCreation.handler()).toEqual(getTreeCreationReference())
  })
})

describe('validateCreatedTreeEdit', () => {
  test('passes a complete edit that keeps the tree a tree', () => {
    expect(validateCreatedTreeEdit(tree, edits)).toMatchObject(edits)
  })

  test.each(['Enhanced', 'Retained'])(
    'refuses a tree that is %s as FEATURE_NOT_EDITABLE',
    (retentionCategory) => {
      expect(() =>
        validateCreatedTreeEdit({ ...tree, retentionCategory }, edits)
      ).toThrow(
        expect.objectContaining({
          message: 'Only a Created tree can be edited',
          output: expect.objectContaining({
            payload: expect.objectContaining({
              code: ERROR_CODES.FEATURE_NOT_EDITABLE
            })
          })
        })
      )
    }
  )

  test('refuses an edit without the complete Created payload', () => {
    const { ref: _ref, ...dropdownsOnly } = edits
    expect(() => validateCreatedTreeEdit(tree, dropdownsOnly)).toThrow(
      /reference, habitat, condition and timing together/
    )
  })

  test.each([
    ['another broad habitat', { broadType: 'Grassland' }],
    ['a non-tree habitat type', { habitatType: 'Modified grassland' }],
    ['a blank habitat type', { habitatType: null }]
  ])('refuses %s as FEATURE_NOT_EDITABLE', (_label, overrides) => {
    let thrown
    try {
      validateCreatedTreeEdit(tree, { ...edits, ...overrides })
    } catch (err) {
      thrown = err
    }
    expect(thrown?.output.statusCode).toBe(400)
    expect(thrown?.output.payload.code).toBe(ERROR_CODES.FEATURE_NOT_EDITABLE)
  })

  test('refuses a condition a tree cannot be created to', () => {
    expect(() =>
      validateCreatedTreeEdit(tree, {
        ...edits,
        condition: 'Condition Assessment N/A'
      })
    ).toThrow(/target condition/)
  })

  test('refuses a positive advance and delay together', () => {
    expect(() =>
      validateCreatedTreeEdit(tree, {
        ...edits,
        advanceYears: 2,
        delayYears: 1
      })
    ).toThrow(/not both/)
  })
})

describe('PUT /projects/{projectId}/post-intervention/trees/{featureId}', () => {
  beforeEach(() => vi.clearAllMocks())

  test('is a PUT at the tree path', () => {
    expect(updatePostInterventionTree.method).toBe('PUT')
    expect(updatePostInterventionTree.path).toBe(
      '/projects/{projectId}/post-intervention/trees/{featureId}'
    )
  })

  test('takes the Created payload, and refuses a comment', () => {
    const schema = updatePostInterventionTree.options.validate.payload
    expect(schema.validate(edits).error).toBeUndefined()
    expect(schema.validate({ ...edits, comment: 'x' }).error).toBeDefined()
  })

  test('saves the tree re-priced as an Urban tree', async () => {
    const saved = await put(edits)

    expect(saved).toMatchObject({
      featureId,
      ref: 'T026',
      status: 'Complete',
      proposed: { type: 'Urban tree', condition: 'Moderate' }
    })
    expect(setProjectFeature).toHaveBeenCalledTimes(1)
    const [, , written] = setProjectFeature.mock.calls[0]
    expect(written).toMatchObject({
      documentKey: 'postIntervention',
      layer: 'trees',
      index: 0
    })
  })

  test('refuses a change to a non-tree habitat, and writes nothing', async () => {
    await expect(
      put({
        ...edits,
        broadType: 'Grassland',
        habitatType: 'Modified grassland'
      })
    ).rejects.toMatchObject({
      output: {
        statusCode: 400,
        payload: { code: ERROR_CODES.FEATURE_NOT_EDITABLE }
      }
    })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('refuses an Enhanced tree, and writes nothing', async () => {
    await expect(
      put(edits, { ...tree, retentionCategory: 'Enhanced' })
    ).rejects.toMatchObject({
      output: {
        statusCode: 400,
        payload: { code: ERROR_CODES.FEATURE_NOT_EDITABLE }
      }
    })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('answers 404 for a feature that is not a tree', async () => {
    await expect(
      updatePostInterventionTree.handler(
        routeRequest(edits, tree, 'habitats'),
        {}
      )
    ).rejects.toMatchObject({ output: { statusCode: 404 } })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })
})
