import { describe, test, expect, vi, beforeEach } from 'vitest'
import { calculateEnhancedWatercoursePostIntervention } from 'bng-library/metric'
import { validateCreatedWatercourseEdit } from './created-watercourse-edit.js'
import { applyFeatureUpdate } from '../utilities/features/apply-feature-update.js'
import { updatePostInterventionWatercourse } from './habitats.js'
import { setProjectFeature } from '../db/persist-project.js'
import { postInterventionWatercourseSchema } from '../validation/post-intervention/project-post-intervention-schema.js'

vi.mock('../db/persist-project.js', () => ({ setProjectFeature: vi.fn() }))
vi.mock('../db/feature-geometry-refs.js', () => ({ setGeometryRefs: vi.fn() }))

const featureId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
// The baseline watercourse and the Enhanced one differ in length, so a price
// that read one length for both would show.
const SIZE_METRES = 500
const LENGTH_KM = 0.5
const PROPOSED_METRES = 400
const PROPOSED_KM = 0.4

// BMD-1047: an Enhanced Culvert in Poor condition, enhanced to Ditches, linked
// by ref to its baseline watercourse. A Low distinctiveness baseline may move
// to any Medium distinctiveness watercourse (BMD-820 AC10).
const baseline = { type: 'Culvert', condition: 'Poor' }
const baselineWatercourse = {
  featureId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  ref: 'WC-1',
  sizeMetres: SIZE_METRES,
  ...baseline
}
const feature = {
  featureId,
  ref: 'WC-1',
  retentionCategory: 'Enhanced',
  sizeMetres: PROPOSED_METRES,
  units: 1,
  status: 'Complete',
  baseline,
  proposed: {
    type: 'Ditches',
    condition: 'Moderate',
    strategicSignificance: 'Low',
    watercourseEncroachment: 'No Encroachment',
    riparianEncroachment: 'No Encroachment/No Encroachment',
    advanceYears: 0,
    delayYears: 0
  }
}
const edits = {
  ref: 'WC-1',
  habitatType: 'Canals',
  condition: 'Good',
  strategicSignificance: 'High',
  watercourseEncroachment: 'Minor',
  riparianEncroachment: 'Minor/No Encroachment',
  advanceYears: 0,
  delayYears: 2
}

function update(overrides = {}, stored = feature) {
  const watercourses = [baselineWatercourse]
  return applyFeatureUpdate(
    {
      baseline: { watercourses },
      postIntervention: { watercourses: [stored] }
    },
    {
      featureId,
      edits: validateCreatedWatercourseEdit(stored, {
        ...edits,
        ...overrides
      }),
      documentKey: 'postIntervention',
      expectedType: 'watercourse',
      baseline: { watercourses }
    }
  )
}

function request(payload, stored = feature) {
  const row = {
    project: {
      baseline: { watercourses: [baselineWatercourse] },
      postIntervention: { watercourses: [stored] }
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

const refused = {
  output: {
    statusCode: 422,
    payload: { code: 'ENHANCEMENT_NOT_VALID', rule: 'offered-enhancement' }
  }
}

// The refusal validateCreatedWatercourseEdit throws, as the route returns it.
function refusal(stored, overrides) {
  try {
    validateCreatedWatercourseEdit(stored, { ...edits, ...overrides })
  } catch (error) {
    return error
  }
  return null
}

beforeEach(() => vi.clearAllMocks())

describe('BMD-1047 Enhanced watercourse edits', () => {
  test('AC12 Scenario A: a complete edit saves its values and the enhanced units against the baseline length', () => {
    const result = update()
    expect(result.status).toBe('ok')
    const expected = calculateEnhancedWatercoursePostIntervention(
      LENGTH_KM,
      PROPOSED_KM,
      'Culvert',
      'Canals',
      'Poor',
      'Good',
      {
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/No Encroachment',
        advanceYears: 0,
        delayYears: 2,
        strategicSignificance: 'High'
      }
    )
    expect(expected.units).toBeGreaterThan(0)
    expect(result.feature).toMatchObject({
      ref: 'WC-1',
      retentionCategory: 'Enhanced',
      status: 'Complete',
      units: expected.units,
      baseline,
      proposed: {
        type: 'Canals',
        condition: 'Good',
        strategicSignificance: 'High',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/No Encroachment',
        advanceYears: 0,
        delayYears: 2,
        difficulty: expected.difficulty
      }
    })
    // A distinctiveness uplift from Culvert is a fixed 10 years.
    expect(result.feature.proposed.standardTimeToTargetCondition).toContain(
      '10'
    )
    expect(result.unitsTotals.watercoursesTotal).toBe(expected.units)
    expect(
      postInterventionWatercourseSchema.validate(result.feature).error
    ).toBeUndefined()
  })

  test.each([
    ['strategic significance', { strategicSignificance: null }],
    ['target condition', { condition: null }],
    ['habitat type', { habitatType: null, condition: null }],
    ['watercourse encroachment', { watercourseEncroachment: null }],
    ['riparian encroachment', { riparianEncroachment: null }],
    ['advance', { advanceYears: null }],
    ['delay', { delayYears: null }]
  ])(
    'AC12 Scenario B: a blank %s saves zero units and Incomplete',
    (_field, overrides) => {
      const result = update(overrides)
      expect(result.status).toBe('ok')
      expect(result.feature).toMatchObject({
        status: 'Incomplete',
        units: 0,
        retentionCategory: 'Enhanced'
      })
    }
  )

  test('a Medium baseline keeps its habitat type and moves to a better condition', () => {
    const ditches = {
      ...feature,
      baseline: { type: 'Ditches', condition: 'Moderate' },
      proposed: { ...feature.proposed, type: 'Ditches', condition: 'Good' }
    }
    expect(
      validateCreatedWatercourseEdit(ditches, {
        ...edits,
        habitatType: 'Ditches',
        condition: 'Fairly Good'
      })
    ).toMatchObject({ habitatType: 'Ditches', condition: 'Fairly Good' })
  })

  test.each([
    ['a Medium baseline moved to another habitat type', 'Ditches', 'Canals'],
    ['a Medium baseline kept at its own condition', 'Ditches', 'Ditches']
  ])(
    'refuses %s as an invalid enhancement',
    (_case, baselineType, habitatType) => {
      const stored = {
        ...feature,
        baseline: { type: baselineType, condition: 'Moderate' }
      }
      expect(
        refusal(stored, { habitatType, condition: 'Moderate' })
      ).toMatchObject(refused)
    }
  )

  test('refuses Culvert as the enhanced habitat type', () => {
    expect(
      refusal(feature, { habitatType: 'Culvert', condition: 'Poor' })
    ).toMatchObject(refused)
  })

  // The PO's ruling (BMD-1046 testing): a stored choice the list does not
  // offer is cleared on the edit page, so it is never sent back. Unlike an
  // Enhanced hedgerow's, a resent one is refused, not kept.
  test('refuses a stored habitat type and condition its baseline no longer offers, sent back unchanged', () => {
    const stored = {
      ...feature,
      baseline: { type: 'Ditches', condition: 'Good' },
      proposed: { ...feature.proposed, type: 'Ditches', condition: 'Good' }
    }
    expect(
      refusal(stored, { habitatType: 'Ditches', condition: 'Good' })
    ).toMatchObject(refused)
  })

  test('an omitted habitat type and condition keep the stored ones, unchecked', () => {
    const { habitatType: _type, condition: _condition, ...rest } = edits
    expect(
      validateCreatedWatercourseEdit(feature, { ...rest, ref: 'WC-1 renamed' })
    ).toMatchObject({ habitatType: 'Ditches', condition: 'Moderate' })
  })

  test('the encroachment lists are not restricted by the enhancement rules', async () => {
    const saved = await updatePostInterventionWatercourse.handler(
      request({
        ...edits,
        watercourseEncroachment: 'Major',
        riparianEncroachment: 'Major/Major'
      })
    )
    expect(saved).toMatchObject({
      status: 'Complete',
      proposed: {
        watercourseEncroachment: 'Major',
        riparianEncroachment: 'Major/Major'
      }
    })
  })

  test('the route saves an edit and returns the saved watercourse', async () => {
    const saved = await updatePostInterventionWatercourse.handler(
      request(edits)
    )
    expect(saved).toMatchObject({
      status: 'Complete',
      proposed: { type: 'Canals', condition: 'Good' }
    })
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({ feature: saved })
    )
  })

  test('the route refuses an invalid enhancement and writes nothing', async () => {
    await expect(
      updatePostInterventionWatercourse.handler(
        request({ ...edits, habitatType: 'Culvert', condition: 'Poor' })
      )
    ).rejects.toMatchObject(refused)
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('a Created watercourse still chooses from the creation list', () => {
    expect(
      validateCreatedWatercourseEdit(
        { ...feature, retentionCategory: 'Created' },
        { ...edits, habitatType: 'Culvert', condition: 'Poor' }
      )
    ).toMatchObject({ habitatType: 'Culvert' })
  })

  test('a rename is priced against the baseline it was renamed from, and records that parent', () => {
    const { units } = update().feature
    const result = update({ ref: 'WC-1 renamed' })
    expect(result.status).toBe('ok')
    expect(result.feature).toMatchObject({
      ref: 'WC-1 renamed',
      status: 'Complete',
      parentFeatureId: baselineWatercourse.featureId,
      units
    })
    // Saving it again, now by its parent, keeps the units.
    const again = update({ ref: 'WC-1 renamed' }, result.feature)
    expect(again.feature.units).toBe(units)
  })

  test('a BNG Service template watercourse that names no parent is priced by its new ref when renamed', () => {
    // A template row that names no parent finds none by its old ref, so the
    // baseline watercourse carrying its old ref must not price the rename.
    const template = { ...feature, templateTable: 'Watercourses' }
    const watercourses = [baselineWatercourse]
    const result = applyFeatureUpdate(
      {
        baseline: { watercourses },
        postIntervention: { template: 'bng-service', watercourses: [template] }
      },
      {
        featureId,
        edits: { ...edits, ref: 'WC-1 renamed' },
        documentKey: 'postIntervention',
        expectedType: 'watercourse',
        baseline: { watercourses }
      }
    )
    expect(result.status).toBe('ok')
    // A template watercourse edit re-derives the post-intervention document,
    // which prices the renamed row as an upload would: matched to no baseline,
    // it is Incomplete with no units.
    expect(result.feature).toMatchObject({
      ref: 'WC-1 renamed',
      units: null,
      status: 'Incomplete'
    })
    expect(result.feature).not.toHaveProperty('parentFeatureId')
  })
})
