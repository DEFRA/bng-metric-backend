import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  calculateCreatedWatercoursePostIntervention,
  roundToSigFigs
} from 'bng-library/metric'
import { getWatercourseCreationReference } from '../validation/reference/watercourse-creation.js'
import {
  postInterventionWatercourseEditPayload,
  validateCreatedWatercourseEdit
} from './created-watercourse-edit.js'
import { updatePostInterventionWatercourse } from './habitats.js'
import { applyFeatureUpdate } from '../utilities/features/apply-feature-update.js'
import { setProjectFeature } from '../db/persist-project.js'
import { setGeometryRefs } from '../db/feature-geometry-refs.js'
import { postInterventionWatercourseSchema } from '../validation/post-intervention/project-post-intervention-schema.js'
import {
  resyncPostInterventionBaselineSide,
  rederivePostInterventionFromBaseline
} from '../utilities/enrichment/post-intervention/resync-post-intervention-baseline.js'

vi.mock('../db/persist-project.js', () => ({ setProjectFeature: vi.fn() }))
vi.mock('../db/feature-geometry-refs.js', () => ({ setGeometryRefs: vi.fn() }))
const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const feature = {
  featureId,
  ref: 'W-1',
  retentionCategory: 'Created',
  sizeMetres: 1250,
  units: null,
  status: 'Incomplete',
  baseline: { type: 'Ditches', condition: 'Poor' },
  proposed: {
    type: 'Ditches',
    condition: 'Moderate',
    watercourseEncroachment: 'No Encroachment',
    riparianEncroachment: 'No Encroachment/No Encroachment',
    strategicSignificance: 'Low',
    advanceYears: 0,
    delayYears: 0
  }
}
const edits = {
  ref: 'Edited watercourse',
  habitatType: 'Ditches',
  condition: 'Good',
  strategicSignificance: 'High',
  watercourseEncroachment: 'Minor',
  riparianEncroachment: 'Minor/No Encroachment',
  advanceYears: 0,
  delayYears: 0
}
const reference = getWatercourseCreationReference()

function update(overrides = {}, stored = feature, baseline) {
  return applyFeatureUpdate(
    {
      baseline,
      postIntervention: {
        watercourses: [
          stored,
          {
            ...feature,
            featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            units: 4,
            status: 'Complete'
          }
        ]
      }
    },
    {
      featureId,
      edits: { ...edits, ...overrides },
      expectedType: 'watercourse',
      documentKey: 'postIntervention'
    }
  )
}

function request(payload, stored = feature) {
  const tx = {
    execute: vi.fn(),
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: async () => [
              { project: { postIntervention: { watercourses: [stored] } } }
            ]
          })
        })
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

beforeEach(() => vi.resetAllMocks())

const templateParent = {
  featureId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  ref: 'W-1',
  type: 'Ditches',
  condition: 'Moderate',
  sizeMetres: 1250,
  strategicSignificance: 'Low',
  watercourseEncroachment: 'No Encroachment',
  riparianEncroachment: 'No Encroachment/No Encroachment'
}
function templateProject(pieces = 1) {
  return {
    baseline: { watercourses: [templateParent] },
    postIntervention: {
      template: { name: 'bng-service', version: '1.0' },
      watercourses: Array.from({ length: pieces }, (_, index) => ({
        ...structuredClone(feature),
        featureId: index ? 'cccccccc-cccc-cccc-cccc-cccccccccccc' : featureId,
        parentFeatureId: templateParent.featureId,
        sizeMetres: 1250 / pieces,
        properties: { 'Habitat created in advance/years': 5 },
        proposed: {
          ...feature.proposed,
          advanceYears: 5,
          watercourseEncroachment: 'Major'
        }
      }))
    }
  }
}

test.each([2, null, '30+'])(
  'keeps saved advance %s through the full template baseline rederive',
  (advanceYears) => {
    const project = templateProject()
    const result = applyFeatureUpdate(project, {
      featureId,
      documentKey: 'postIntervention',
      expectedType: 'watercourse',
      edits: { ...edits, condition: 'Moderate', advanceYears }
    })
    const expected = advanceYears === '30+' ? 30 : advanceYears
    expect(result.status).toBe('ok')
    expect(result.feature.editedAdvanceYears).toBe(expected)
    const rederived = rederivePostInterventionFromBaseline(
      result.project.postIntervention,
      {
        baseline: {
          watercourses: [{ ...templateParent, ref: 'Renamed baseline' }]
        },
        previousBaseline: project.baseline
      }
    )
    expect(rederived.watercourses[0].proposed.advanceYears).toBe(expected)
    expect(
      postInterventionWatercourseSchema.validate(rederived.watercourses[0])
        .error
    ).toBeUndefined()
  }
)

test.each([10, '30+'])(
  'keeps saved advance %s across lineage nulling, a rename with omitted advance, and a baseline correction',
  (advanceYears) => {
    const project = templateProject()
    const saved = applyFeatureUpdate(project, {
      featureId,
      documentKey: 'postIntervention',
      expectedType: 'watercourse',
      edits: { ...edits, condition: 'Poor', advanceYears }
    })
    const numericAdvance = advanceYears === '30+' ? 30 : advanceYears
    expect(saved.feature.proposed.advanceYears).toBeNull()
    expect(saved.feature.editedAdvanceYears).toBe(numericAdvance)
    const { advanceYears: _advance, ...rename } = {
      ...edits,
      ref: 'Renamed while restricted',
      condition: 'Poor'
    }
    const resolved = validateCreatedWatercourseEdit(saved.feature, rename)
    expect(resolved.advanceYears).toBe(advanceYears)
    expect(rename).not.toHaveProperty('advanceYears')
    const renamed = applyFeatureUpdate(saved.project, {
      featureId,
      documentKey: 'postIntervention',
      expectedType: 'watercourse',
      edits: resolved
    })
    expect(renamed.feature.proposed.advanceYears).toBeNull()
    expect(renamed.feature.editedAdvanceYears).toBe(numericAdvance)
    const rederived = rederivePostInterventionFromBaseline(
      renamed.project.postIntervention,
      {
        baseline: { watercourses: [{ ...templateParent, condition: 'Poor' }] },
        previousBaseline: project.baseline
      }
    )
    expect(rederived.watercourses[0].proposed.advanceYears).toBe(numericAdvance)
    expect(rederived.watercourses[0].ref).toBe(rename.ref)
    expect(rederived.watercourses[0].status).toBe('Complete')
    expect(
      validateCreatedWatercourseEdit(renamed.feature, {
        ...rename,
        advanceYears: null
      }).advanceYears
    ).toBeNull()
  }
)

test.each([
  ['condition', { condition: 'Poor' }, false],
  ['type', { habitatType: 'Canals' }, true]
])(
  'applies the lineage rule after a %s edit and persists affected siblings: %s',
  (_, change, siblingAffected) => {
    const project = templateProject(2)
    for (const row of project.postIntervention.watercourses) {
      row.proposed.advanceYears = 10
      row.editedAdvanceYears = 10
    }
    const result = applyFeatureUpdate(project, {
      featureId,
      documentKey: 'postIntervention',
      expectedType: 'watercourse',
      edits: { ...edits, condition: 'Moderate', advanceYears: 10, ...change }
    })
    expect(result.status).toBe('ok')
    expect(result.feature.proposed.advanceYears).toBeNull()
    expect(result.feature.units).toBeNull()
    expect(result.feature.status).toBe('Incomplete')
    expect(result.postIntervention).toBe(result.project.postIntervention)
    expect(result.postIntervention.watercourses[1].proposed.advanceYears).toBe(
      siblingAffected ? null : 10
    )
    if (siblingAffected) {
      expect(result.postIntervention.watercourses[1].units).toBeNull()
      expect(result.postIntervention.watercourses[1].status).toBe('Incomplete')
      expect(result.unitsTotals.watercoursesTotal).toBe(0)
    }
    expect(project.postIntervention.watercourses[1].proposed.advanceYears).toBe(
      10
    )
    expect(result.unitsTotals).toEqual(result.postIntervention.units)
  }
)

describe('BMD-1050 Created watercourse editing', () => {
  test('creation choices and derived values come from the pinned public calculator', () => {
    expect(reference.featureType).toBe('watercourse')
    expect(reference.habitatTypes.map((t) => t.name)).toEqual([
      'Canals',
      'Culvert',
      'Ditches'
    ])
    for (const type of reference.habitatTypes) {
      expect(type).not.toHaveProperty('broad')
      for (const choice of type.conditions) {
        const metrics = calculateCreatedWatercoursePostIntervention(
          1,
          type.name,
          choice.condition,
          'No Encroachment',
          'No Encroachment/No Encroachment',
          0,
          0,
          'Low'
        )
        expect(String(choice.years)).toBe(
          String(metrics.standardTimeToTargetCondition)
        )
        expect(type.difficultyMultiplier).toBe(metrics.difficultyMultiplier)
        expect(type.difficulty).toBe(metrics.difficulty)
      }
    }
    const clone = getWatercourseCreationReference()
    clone.watercourseEncroachment.length = 0
    expect(getWatercourseCreationReference().watercourseEncroachment).toEqual(
      reference.watercourseEncroachment
    )
  })

  test.each([
    ...reference.watercourseEncroachment.map((value) => ({
      watercourseEncroachment: value
    })),
    ...reference.riparianEncroachment.map((value) => ({
      riparianEncroachment: value
    })),
    { advanceYears: 2 },
    { delayYears: 3 },
    { advanceYears: '30+' },
    { delayYears: '30+' }
  ])(
    'uses both independent encroachment multipliers and timing for %j',
    (overrides) => {
      const values = { ...edits, ...overrides }
      const result = update(overrides)
      const expected = calculateCreatedWatercoursePostIntervention(
        1.25,
        values.habitatType,
        values.condition,
        values.watercourseEncroachment,
        values.riparianEncroachment,
        values.advanceYears,
        values.delayYears,
        values.strategicSignificance
      )
      expect(result.status).toBe('ok')
      expect(result.feature).toMatchObject({
        ref: edits.ref,
        sizeMetres: 1250,
        retentionCategory: 'Created',
        status: 'Complete',
        units: expected.units,
        proposed: {
          watercourseEncroachment: values.watercourseEncroachment,
          riparianEncroachment: values.riparianEncroachment,
          waterEncroachmentMultiplier: expected.waterEncroachmentMultiplier,
          riparianEncroachmentMultiplier:
            expected.riparianEncroachmentMultiplier
        }
      })
      expect(result.unitsTotals.watercoursesTotal).toBeCloseTo(
        roundToSigFigs(expected.units + 4)
      )
      expect(
        postInterventionWatercourseSchema.validate(result.feature).error
      ).toBeUndefined()
      expect(feature.ref).toBe('W-1')
    }
  )

  test.each([
    'habitatType',
    'condition',
    'strategicSignificance',
    'advanceYears',
    'delayYears',
    'watercourseEncroachment',
    'riparianEncroachment'
  ])('clearing %s saves Incomplete with no unit contribution', (field) => {
    const result = update({
      [field]: null,
      ...(field === 'habitatType' ? { condition: null } : {})
    })
    expect(result.feature.status).toBe('Incomplete')
    expect(result.feature.units).toBeNull()
    expect(result.unitsTotals.watercoursesTotal).toBe(4)
    expect(result.feature.proposed.waterEncroachmentMultiplier).toBeNull()
    expect(result.feature.proposed.riparianEncroachmentMultiplier).toBeNull()
    expect(
      postInterventionWatercourseSchema.validate(result.feature).error
    ).toBeUndefined()
  })

  test.each(['Retained', 'Enhanced', null])(
    'rejects editing %s watercourses',
    (retentionCategory) => {
      expect(() =>
        validateCreatedWatercourseEdit({ ...feature, retentionCategory }, edits)
      ).toThrow('Created watercourses')
    }
  )

  test.each([
    { ref: ' ' },
    { ref: '\uFFFD' },
    { advanceYears: 1, delayYears: 1 },
    { habitatType: 'Native hedgerow' },
    { habitatType: 'Culvert', condition: 'Good' }
  ])('rejects invalid values before persistence: %j', async (overrides) => {
    await expect(
      updatePostInterventionWatercourse.handler(
        request({ ...edits, ...overrides })
      )
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
    expect(setProjectFeature).not.toHaveBeenCalled()
    expect(setGeometryRefs).not.toHaveBeenCalled()
  })

  test.each([
    { watercourseEncroachment: 'invalid' },
    { riparianEncroachment: 'Minor' },
    { broadType: 'Grassland' },
    { sizeMetres: 1 },
    { units: 999 },
    { advanceYears: 2.5 },
    { delayYears: 31 }
  ])(
    'schema refuses unsupported new choices and immutable fields: %j',
    (overrides) => {
      expect(
        postInterventionWatercourseEditPayload.validate({
          ...edits,
          ...overrides
        }).error
      ).toBeDefined()
    }
  )

  test('normalises legacy retention and persists all fragments with the verified actor', async () => {
    const stored = structuredClone(feature)
    delete stored.retentionCategory
    stored.baseline.retentionCategory = 'Created'
    setProjectFeature.mockImplementationOnce((_tx, _id, { feature: saved }) => {
      expect(
        postInterventionWatercourseSchema.validate(saved).error
      ).toBeUndefined()
    })
    const saved = await updatePostInterventionWatercourse.handler(
      request(edits, stored)
    )
    expect(saved.retentionCategory).toBe('Created')
    expect(saved.baseline).not.toHaveProperty('retentionCategory')
    expect(stored.baseline.retentionCategory).toBe('Created')
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({
        documentKey: 'postIntervention',
        layer: 'watercourses',
        feature: saved,
        actorId: 'test-user',
        unitsTotals: expect.anything(),
        tradingRules: expect.anything()
      })
    )
    expect(setGeometryRefs).toHaveBeenCalled()
  })

  test('omitted imported values survive unrelated edits; explicit null still clears', async () => {
    const stored = {
      ...feature,
      proposed: {
        ...feature.proposed,
        advanceYears: 2.5,
        watercourseEncroachment: 'Imported invalid value'
      }
    }
    const payload = {
      ref: 'Renamed',
      habitatType: 'Ditches',
      strategicSignificance: 'Low'
    }
    expect(
      postInterventionWatercourseEditPayload.validate(payload).error
    ).toBeUndefined()
    const saved = await updatePostInterventionWatercourse.handler(
      request(payload, stored)
    )
    expect(saved.proposed).toMatchObject({
      condition: 'Moderate',
      advanceYears: 2.5,
      watercourseEncroachment: 'Imported invalid value',
      riparianEncroachment: 'No Encroachment/No Encroachment'
    })
    const cleared = await updatePostInterventionWatercourse.handler(
      request(
        { ...payload, advanceYears: null, watercourseEncroachment: null },
        stored
      )
    )
    expect(cleared.proposed.advanceYears).toBeNull()
    expect(cleared.proposed.watercourseEncroachment).toBeNull()
    expect(cleared.proposed.riparianEncroachment).toBe(
      feature.proposed.riparianEncroachment
    )
  })

  test.each([true, false])(
    'renaming preserves original baseline lineage, including no parent: %s',
    (hasParent) => {
      const parentId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      const baseline = {
        watercourses: [
          ...(hasParent
            ? [
                {
                  featureId: parentId,
                  ref: 'W-1',
                  type: 'Ditches',
                  condition: 'Poor'
                }
              ]
            : []),
          {
            featureId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            ref: 'W-2',
            type: 'Canals',
            condition: 'Good'
          }
        ]
      }
      const result = update({ ref: 'W-2' }, feature, baseline)
      expect(result.feature).toMatchObject({
        ref: 'W-2',
        referenceEdited: true,
        parentFeatureId: hasParent ? parentId : null
      })
      const changed = structuredClone(baseline)
      if (hasParent) {
        changed.watercourses[0].ref = 'Baseline renamed'
      }
      resyncPostInterventionBaselineSide(
        { watercourses: [result.feature] },
        { baseline: changed, previousBaseline: baseline }
      )
      expect(result.feature.ref).toBe('W-2')
      expect(result.feature.baseline.type).toBe('Ditches')
      expect(
        postInterventionWatercourseSchema.validate(result.feature).error
      ).toBeUndefined()
    }
  )
})
