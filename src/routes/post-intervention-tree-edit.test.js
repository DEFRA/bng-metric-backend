import { describe, test, expect, vi, beforeEach } from 'vitest'

import {
  getTreeCreationReference,
  getTreeEnhancementReference
} from '../validation/reference/area-creation.js'
import { validatePostInterventionTreeEdit } from './post-intervention-tree-edit.js'
import { updatePostInterventionTree } from './habitats.js'
import { getTreeCreation, getTreeEnhancement } from './reference.js'
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

// A Small urban tree in Poor condition, kept and enhanced to Good.
const enhancedTree = {
  featureId,
  ref: 'T001',
  retentionCategory: 'Enhanced',
  count: null,
  sizeSquareMetres: 41,
  area: 41,
  units: 0.0309,
  status: 'Complete',
  baseline: {
    broadType: 'Individual trees',
    type: 'Urban tree',
    treeSize: 'Small',
    condition: 'Poor',
    strategicSignificance: 'Low',
    sizeSquareMetres: 41
  },
  proposed: {
    broadType: 'Individual trees',
    type: 'Urban tree',
    treeSize: 'Small',
    condition: 'Good',
    strategicSignificance: 'High',
    advanceYears: 0,
    delayYears: 0,
    sizeSquareMetres: 41
  },
  properties: {}
}

const enhancedEdits = {
  ref: 'T001',
  broadType: 'Individual trees',
  habitatType: 'Urban tree',
  condition: 'Moderate',
  strategicSignificance: 'Low',
  advanceYears: 0,
  delayYears: 0
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

describe('Enhanced tree reference', () => {
  test('offers Urban tree and Rural tree, at the enhancement difficulty', () => {
    const reference = getTreeEnhancementReference()

    expect(reference.habitatTypes.map((t) => [t.broad, t.name])).toEqual([
      ['Individual trees', 'Rural tree'],
      ['Individual trees', 'Urban tree']
    ])
    for (const type of reference.habitatTypes) {
      expect(type).toMatchObject({ difficulty: 'Low', difficultyMultiplier: 1 })
    }
    expect(reference.strategicSignificance).toEqual(
      getTreeCreationReference().strategicSignificance
    )
    expect(reference.timeMultipliers).toEqual(
      getTreeCreationReference().timeMultipliers
    )
  })

  test('gives each baseline condition only the better ones, with the years the Metric gives', () => {
    const [{ enhancements }] = getTreeEnhancementReference().habitatTypes
    const targets = (from) =>
      enhancements[from].map((c) => [c.condition, c.years])

    expect(targets('Poor')).toEqual([
      ['Good', '30+'],
      ['Fairly Good', 24],
      ['Moderate', 16],
      ['Fairly Poor', 8]
    ])
    expect(targets('Moderate')).toEqual([
      ['Good', 16],
      ['Fairly Good', 8]
    ])
    expect(targets('Fairly Good')).toEqual([['Good', 8]])
    expect(targets('Good')).toEqual([])
  })

  test('is served at /reference/tree-enhancement, without authentication', () => {
    expect(getTreeEnhancement.path).toBe('/reference/tree-enhancement')
    expect(getTreeEnhancement.options.auth).toBe(false)
    expect(getTreeEnhancement.handler()).toEqual(getTreeEnhancementReference())
  })
})

describe('validatePostInterventionTreeEdit', () => {
  test('passes a complete edit that keeps the tree a tree', () => {
    expect(validatePostInterventionTreeEdit(tree, edits)).toMatchObject(edits)
  })

  test('passes an Enhanced tree edit that keeps its baseline setting', () => {
    expect(
      validatePostInterventionTreeEdit(enhancedTree, enhancedEdits)
    ).toMatchObject(enhancedEdits)
  })

  test('refuses an Enhanced tree moved to another setting as FEATURE_NOT_EDITABLE', () => {
    let thrown
    try {
      validatePostInterventionTreeEdit(enhancedTree, {
        ...enhancedEdits,
        habitatType: 'Rural tree'
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown?.message).toMatch(/keeps its baseline tree/)
    expect(thrown?.output.payload.code).toBe(ERROR_CODES.FEATURE_NOT_EDITABLE)
  })

  test('refuses a Retained tree as FEATURE_NOT_EDITABLE', () => {
    expect(() =>
      validatePostInterventionTreeEdit(
        { ...tree, retentionCategory: 'Retained' },
        edits
      )
    ).toThrow(
      expect.objectContaining({
        message: 'Only a Created or Enhanced tree can be edited',
        output: expect.objectContaining({
          payload: expect.objectContaining({
            code: ERROR_CODES.FEATURE_NOT_EDITABLE
          })
        })
      })
    )
  })

  test('refuses an edit without the complete Created payload', () => {
    const { ref: _ref, ...dropdownsOnly } = edits
    expect(() => validatePostInterventionTreeEdit(tree, dropdownsOnly)).toThrow(
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
      validatePostInterventionTreeEdit(tree, { ...edits, ...overrides })
    } catch (err) {
      thrown = err
    }
    expect(thrown?.output.statusCode).toBe(400)
    expect(thrown?.output.payload.code).toBe(ERROR_CODES.FEATURE_NOT_EDITABLE)
  })

  test('refuses a condition a tree cannot be created to', () => {
    expect(() =>
      validatePostInterventionTreeEdit(tree, {
        ...edits,
        condition: 'Condition Assessment N/A'
      })
    ).toThrow(/target condition/)
  })

  test('refuses a positive advance and delay together', () => {
    expect(() =>
      validatePostInterventionTreeEdit(tree, {
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

  test('saves an Enhanced tree re-priced as an enhancement to its new target condition', async () => {
    const saved = await put(enhancedEdits, enhancedTree)

    expect(saved).toMatchObject({
      featureId,
      retentionCategory: 'Enhanced',
      status: 'Complete',
      proposed: {
        type: 'Urban tree',
        condition: 'Moderate',
        strategicSignificance: 'Low'
      }
    })
    expect(setProjectFeature).toHaveBeenCalledTimes(1)
  })

  test('refuses an Enhanced tree given a condition no better than its baseline one as ENHANCEMENT_NOT_VALID, and writes nothing', async () => {
    await expect(
      put({ ...enhancedEdits, condition: 'Poor' }, enhancedTree)
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          code: ERROR_CODES.ENHANCEMENT_NOT_VALID,
          rule: 'tree-better-condition'
        }
      }
    })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('refuses a Retained tree, and writes nothing', async () => {
    await expect(
      put(edits, { ...tree, retentionCategory: 'Retained' })
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
