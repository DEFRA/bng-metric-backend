import { describe, test, expect, vi, beforeEach } from 'vitest'

import {
  updatePostInterventionAreaHabitat,
  updatePostInterventionHedgerow,
  updatePostInterventionTree,
  updatePostInterventionWatercourse
} from './habitats.js'
import { setProjectFeature } from '../db/persist-project.js'
import { ERROR_CODES } from '../validation/geopackage/errors.js'

// A Created area habitat, tree, hedgerow or watercourse (BMD-1153), or an
// Enhanced area habitat, tree or hedgerow (BMD-1190), saves its supporting
// information (its comment) with the rest of its edit page.

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

const areaBaseline = {
  broadType: 'Grassland',
  type: 'Modified grassland',
  condition: 'Poor'
}
const hedgerowBaseline = { type: 'Native hedgerow', condition: 'Moderate' }

const CASES = {
  'Created habitat': {
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
  'Created tree': {
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
  'Created hedgerow': {
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
  'Created watercourse': {
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
  },
  // BMD-1045: a Modified grassland at Poor, enhanced within its baseline's
  // valid enhancements.
  'Enhanced habitat': {
    route: updatePostInterventionAreaHabitat,
    layer: 'habitats',
    feature: {
      featureId,
      ref: 'E-1',
      retentionCategory: 'Enhanced',
      sizeSquareMetres: 25000,
      units: 3,
      status: 'Complete',
      comment: STORED_COMMENT,
      baseline: areaBaseline,
      proposed: {
        broadType: 'Grassland',
        type: 'Modified grassland',
        condition: 'Fairly Poor',
        ...timing
      }
    },
    edits: {
      ref: 'E-1',
      broadType: 'Grassland',
      habitatType: 'Modified grassland',
      condition: 'Moderate',
      ...timing
    }
  },
  // BMD-1172: an Urban tree at Poor, enhanced in its baseline tree's setting.
  'Enhanced tree': {
    route: updatePostInterventionTree,
    layer: 'trees',
    feature: {
      featureId,
      ref: 'T001',
      retentionCategory: 'Enhanced',
      count: null,
      sizeSquareMetres: 41,
      area: 41,
      units: 0.01,
      status: 'Complete',
      comment: STORED_COMMENT,
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
      },
      properties: {}
    },
    edits: {
      ref: 'T001',
      broadType: 'Individual trees',
      habitatType: 'Urban tree',
      condition: 'Moderate',
      ...timing
    }
  },
  // BMD-1046: a Native hedgerow at Moderate, linked by ref to its baseline
  // hedgerow, whose length prices the enhancement.
  'Enhanced hedgerow': {
    route: updatePostInterventionHedgerow,
    layer: 'hedgerows',
    baseline: {
      hedgerows: [
        {
          featureId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          ref: 'HG-1',
          sizeMetres: 336,
          ...hedgerowBaseline
        }
      ]
    },
    feature: {
      featureId,
      ref: 'HG-1',
      retentionCategory: 'Enhanced',
      sizeMetres: 200,
      units: 1,
      status: 'Complete',
      comment: STORED_COMMENT,
      baseline: hedgerowBaseline,
      proposed: {
        type: 'Native hedgerow',
        condition: 'Good',
        ...timing
      }
    },
    edits: {
      ref: 'HG-1',
      habitatType: 'Species-rich native hedgerow',
      condition: 'Moderate',
      ...timing
    }
  },
  // BMD-1047: a Ditches at Poor, linked by ref to its baseline watercourse,
  // whose length prices the enhancement.
  'Enhanced watercourse': {
    route: updatePostInterventionWatercourse,
    layer: 'watercourses',
    baseline: {
      watercourses: [
        {
          featureId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          ref: 'W-1',
          sizeMetres: 1250,
          type: 'Ditches',
          condition: 'Poor'
        }
      ]
    },
    feature: {
      featureId,
      ref: 'W-1',
      retentionCategory: 'Enhanced',
      sizeMetres: 1000,
      units: 1,
      status: 'Complete',
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

function request(payload, stored, { layer, baseline }, document = {}) {
  const row = {
    project: {
      ...(baseline ? { baseline } : {}),
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

function put(kind, overrides = {}, stored = CASES[kind].feature) {
  const { route, edits } = CASES[kind]
  return route.handler(
    request({ ...edits, ...overrides }, stored, CASES[kind]),
    {}
  )
}

function validatePayload(kind, overrides) {
  const { route, edits } = CASES[kind]
  return route.options.validate.payload.validate({ ...edits, ...overrides })
}

beforeEach(() => vi.clearAllMocks())

describe.each(Object.keys(CASES))('supporting information: %s', (kind) => {
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
    const { route, edits, feature } = CASES[kind]
    const saved = await route.handler(
      request({ ...edits, comment: 'Edited note' }, feature, CASES[kind], {
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
  // A Retained tree takes no complete edit, comment or not.
  test('refuses a Retained tree sent a comment as FEATURE_NOT_EDITABLE, and writes nothing', async () => {
    const stored = {
      ...CASES['Enhanced tree'].feature,
      retentionCategory: 'Retained'
    }
    await expect(
      put('Enhanced tree', { comment: 'A note' }, stored)
    ).rejects.toMatchObject({
      output: {
        statusCode: 400,
        payload: { code: ERROR_CODES.FEATURE_NOT_EDITABLE }
      }
    })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })
})
