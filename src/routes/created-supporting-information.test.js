import { describe, test, expect, vi, beforeEach } from 'vitest'

import {
  updatePostInterventionAreaHabitat,
  updatePostInterventionHedgerow,
  updatePostInterventionTree,
  updatePostInterventionWatercourse
} from './habitats.js'
import { setProjectFeature } from '../db/persist-project.js'
import { ERROR_CODES } from '../validation/geopackage/errors.js'

// BMD-1153: a Created area habitat, tree, hedgerow or watercourse saves its
// supporting information (its comment) with the rest of its edit page.

vi.mock('../db/persist-project.js', () => ({
  setProjectFeature: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../db/feature-geometry-refs.js', () => ({
  setGeometryRefs: vi.fn().mockResolvedValue(undefined)
}))

const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const MAX_COMMENT_LENGTH = 999
const STORED_COMMENT = 'Imported note'

const timing = {
  strategicSignificance: 'Low',
  advanceYears: 0,
  delayYears: 0
}

const CREATED = {
  habitat: {
    route: updatePostInterventionAreaHabitat,
    layer: 'habitats',
    feature: {
      featureId,
      ref: 'P-1',
      retentionCategory: 'Created',
      sizeSquareMetres: 25000,
      units: 2,
      status: 'Complete',
      comment: STORED_COMMENT,
      baseline: {},
      proposed: {
        broadType: 'Grassland',
        type: 'Modified grassland',
        condition: 'Poor'
      }
    },
    edits: {
      ref: 'P-1',
      broadType: 'Grassland',
      habitatType: 'Modified grassland',
      condition: 'Good',
      ...timing
    }
  },
  tree: {
    route: updatePostInterventionTree,
    layer: 'trees',
    feature: {
      featureId,
      ref: 'T026',
      retentionCategory: 'Created',
      count: 1,
      sizeSquareMetres: 41,
      area: 41,
      units: 0.01,
      status: 'Complete',
      comment: STORED_COMMENT,
      baseline: {},
      proposed: {
        broadType: 'Individual trees',
        type: 'Rural tree',
        treeSize: 'Small',
        condition: 'Poor',
        ...timing
      },
      properties: {}
    },
    edits: {
      ref: 'T026',
      broadType: 'Individual trees',
      habitatType: 'Rural tree',
      condition: 'Moderate',
      ...timing
    }
  },
  hedgerow: {
    route: updatePostInterventionHedgerow,
    layer: 'hedgerows',
    feature: {
      featureId,
      ref: 'H-1',
      retentionCategory: 'Created',
      sizeMetres: 336,
      units: 1,
      status: 'Complete',
      comment: STORED_COMMENT,
      baseline: {},
      proposed: { type: 'Native hedgerow', condition: 'Poor' }
    },
    edits: {
      ref: 'H-1',
      habitatType: 'Native hedgerow',
      condition: 'Good',
      ...timing
    }
  },
  watercourse: {
    route: updatePostInterventionWatercourse,
    layer: 'watercourses',
    feature: {
      featureId,
      ref: 'W-1',
      retentionCategory: 'Created',
      sizeMetres: 1250,
      units: null,
      status: 'Incomplete',
      comment: STORED_COMMENT,
      baseline: { type: 'Ditches', condition: 'Poor' },
      proposed: {
        type: 'Ditches',
        condition: 'Moderate',
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment',
        ...timing
      }
    },
    edits: {
      ref: 'W-1',
      habitatType: 'Ditches',
      condition: 'Good',
      watercourseEncroachment: 'No Encroachment',
      riparianEncroachment: 'No Encroachment/No Encroachment',
      ...timing
    }
  }
}

function request(payload, stored, layer, document = {}) {
  const row = {
    project: {
      postIntervention: {
        ...document,
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

function put(kind, overrides = {}, stored = CREATED[kind].feature) {
  const { route, layer, edits } = CREATED[kind]
  return route.handler(request({ ...edits, ...overrides }, stored, layer), {})
}

function validatePayload(kind, overrides) {
  const { route, edits } = CREATED[kind]
  return route.options.validate.payload.validate({ ...edits, ...overrides })
}

beforeEach(() => vi.clearAllMocks())

describe.each(Object.keys(CREATED))('a Created %s', (kind) => {
  test('saves the comment trimmed, with line breaks as LF', async () => {
    const saved = await put(kind, {
      comment: '  First line\r\nSecond line\rThird  \n'
    })
    expect(saved.comment).toBe('First line\nSecond line\nThird')
    const [, , written] = setProjectFeature.mock.calls[0]
    expect(written.feature.comment).toBe('First line\nSecond line\nThird')
  })

  test.each(['', '   \r\n\t '])(
    'saves a blank or whitespace-only comment as no value: %j',
    async (comment) => {
      const saved = await put(kind, { comment })
      expect(saved.comment).toBeNull()
    }
  )

  test('clears the comment when sent null', async () => {
    const saved = await put(kind, { comment: null })
    expect(saved.comment).toBeNull()
  })

  test('keeps the stored comment when the edit leaves it out', async () => {
    const saved = await put(kind)
    expect(saved.comment).toBe(STORED_COMMENT)
  })

  // A BNG Service template file imports each Post-Intervention row's own
  // Comment; an edit replaces it, as on any other upload.
  test('replaces a comment imported from a BNG Service template file', async () => {
    const { route, layer, edits, feature } = CREATED[kind]
    const saved = await route.handler(
      request({ ...edits, comment: 'Edited note' }, feature, layer, {
        template: true
      }),
      {}
    )
    expect(saved.comment).toBe('Edited note')
  })

  test(`accepts ${MAX_COMMENT_LENGTH} characters once trimmed, counting an emoji as one`, () => {
    const comment = ` ${'😀'.repeat(MAX_COMMENT_LENGTH)} `
    expect(validatePayload(kind, { comment }).error).toBeUndefined()
  })

  test(`refuses more than ${MAX_COMMENT_LENGTH} characters once trimmed`, () => {
    const { error } = validatePayload(kind, {
      comment: 'a'.repeat(MAX_COMMENT_LENGTH + 1)
    })
    expect(error?.message).toMatch(/longer than 999 characters/)
  })

  test('refuses text that is not valid UTF-8', () => {
    const { error } = validatePayload(kind, { comment: 'bad \uD800 text' })
    expect(error?.message).toMatch(/not valid UTF-8/)
  })
})

describe('a feature whose comment this page cannot edit', () => {
  test.each(['habitat', 'hedgerow', 'watercourse'])(
    'refuses an Enhanced %s sent a comment, and writes nothing',
    async (kind) => {
      const stored = {
        ...CREATED[kind].feature,
        retentionCategory: 'Enhanced'
      }
      await expect(
        put(kind, { comment: 'A note' }, stored)
      ).rejects.toMatchObject({ output: { statusCode: 400 } })
      expect(setProjectFeature).not.toHaveBeenCalled()
    }
  )

  describe('an Enhanced tree (BMD-1190)', () => {
    const enhancedTree = {
      ...CREATED.tree.feature,
      ref: 'T001',
      retentionCategory: 'Enhanced',
      count: null,
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
        ...timing,
        sizeSquareMetres: 41
      }
    }
    const enhancedEdits = {
      ref: 'T001',
      habitatType: 'Urban tree',
      condition: 'Moderate'
    }

    test('is refused as FEATURE_NOT_EDITABLE when sent a comment, and writes nothing', async () => {
      await expect(
        put('tree', { ...enhancedEdits, comment: 'A note' }, enhancedTree)
      ).rejects.toMatchObject({
        output: {
          statusCode: 400,
          payload: { code: ERROR_CODES.FEATURE_NOT_EDITABLE }
        }
      })
      expect(setProjectFeature).not.toHaveBeenCalled()
    })

    test('keeps its imported comment through an edit that sends none', async () => {
      const saved = await put('tree', enhancedEdits, enhancedTree)
      expect(saved.comment).toBe(STORED_COMMENT)
    })
  })
})
