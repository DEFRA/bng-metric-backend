import { describe, test, expect, vi, beforeEach } from 'vitest'
import { calculateEnhancedHedgerowPostIntervention } from 'bng-library/metric'
import { validateCreatedHedgerowEdit } from './created-hedgerow-edit.js'
import { applyFeatureUpdate } from '../utilities/features/apply-feature-update.js'
import { updatePostInterventionHedgerow } from './habitats.js'
import { setProjectFeature } from '../db/persist-project.js'
import { postInterventionLinearHabitatSchema } from '../validation/post-intervention/project-post-intervention-schema.js'

vi.mock('../db/persist-project.js', () => ({ setProjectFeature: vi.fn() }))
vi.mock('../db/feature-geometry-refs.js', () => ({ setGeometryRefs: vi.fn() }))

const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
// The baseline hedgerow and the Enhanced one differ in length, so a price
// that read one length for both would show.
const SIZE_METRES = 336
const LENGTH_KM = 0.336
const PROPOSED_METRES = 200
const PROPOSED_KM = 0.2

// BMD-1046: an Enhanced Native hedgerow at Moderate, enhanced to Good, linked
// by ref to its baseline hedgerow.
const baseline = { type: 'Native hedgerow', condition: 'Moderate' }
const baselineHedgerow = {
  featureId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  ref: 'HG-1',
  sizeMetres: SIZE_METRES,
  ...baseline
}
const feature = {
  featureId,
  ref: 'HG-1',
  retentionCategory: 'Enhanced',
  sizeMetres: PROPOSED_METRES,
  units: 1,
  status: 'Complete',
  baseline,
  proposed: {
    type: 'Native hedgerow',
    condition: 'Good',
    strategicSignificance: 'Low',
    advanceYears: 0,
    delayYears: 0
  }
}
const edits = {
  ref: 'HG-1',
  habitatType: 'Species-rich native hedgerow',
  condition: 'Moderate',
  strategicSignificance: 'High',
  advanceYears: 0,
  delayYears: 2
}

function update(
  overrides = {},
  stored = feature,
  hedgerows = [baselineHedgerow]
) {
  return applyFeatureUpdate(
    {
      baseline: { hedgerows },
      postIntervention: { hedgerows: [stored] }
    },
    {
      featureId,
      edits: { ...edits, ...overrides },
      documentKey: 'postIntervention',
      expectedType: 'hedgerow',
      baseline: { hedgerows }
    }
  )
}

const unitsAt = (baselineKm) =>
  calculateEnhancedHedgerowPostIntervention(
    baselineKm,
    PROPOSED_KM,
    'Native hedgerow',
    'Species-rich native hedgerow',
    'Moderate',
    'Moderate',
    { advanceYears: 0, delayYears: 2, strategicSignificance: 'High' }
  ).units

function request(payload, stored = feature) {
  const row = {
    project: {
      baseline: { hedgerows: [baselineHedgerow] },
      postIntervention: { hedgerows: [stored] }
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

beforeEach(() => vi.clearAllMocks())

describe('BMD-1046 Enhanced hedgerow edits', () => {
  test('AC10 Scenario A: a complete edit saves its values and the enhanced units against the baseline length', () => {
    const result = update()
    expect(result.status).toBe('ok')
    const expected = calculateEnhancedHedgerowPostIntervention(
      LENGTH_KM,
      PROPOSED_KM,
      'Native hedgerow',
      'Species-rich native hedgerow',
      'Moderate',
      'Moderate',
      { advanceYears: 0, delayYears: 2, strategicSignificance: 'High' }
    )
    expect(result.feature).toMatchObject({
      ref: 'HG-1',
      retentionCategory: 'Enhanced',
      status: 'Complete',
      units: expected.units,
      baseline,
      proposed: {
        type: 'Species-rich native hedgerow',
        condition: 'Moderate',
        strategicSignificance: 'High',
        advanceYears: 0,
        delayYears: 2,
        difficulty: expected.difficulty
      }
    })
    // A move to a more distinctive type takes G-6's type-to-type time.
    expect(result.feature.proposed.standardTimeToTargetCondition).toContain('5')
    expect(result.unitsTotals.hedgerowsTotal).toBe(expected.units)
    expect(
      postInterventionLinearHabitatSchema.validate(result.feature).error
    ).toBeUndefined()
  })

  test.each([
    ['strategic significance', { strategicSignificance: null }],
    ['target condition', { condition: null }],
    ['habitat type', { habitatType: null, condition: null }],
    ['advance', { advanceYears: null }],
    ['delay', { delayYears: null }]
  ])(
    'AC10 Scenario B: a blank %s saves zero units and Incomplete',
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

  test('a rename is priced against the baseline it was renamed from, and records that parent', () => {
    const result = update({ ref: 'HG-1 renamed' })
    expect(result.status).toBe('ok')
    expect(result.feature).toMatchObject({
      ref: 'HG-1 renamed',
      status: 'Complete',
      referenceEdited: true,
      parentFeatureId: baselineHedgerow.featureId,
      units: unitsAt(LENGTH_KM)
    })
    expect(result.unitsTotals.hedgerowsTotal).toBe(unitsAt(LENGTH_KM))
    // Saving it again, now by its parent, keeps the units and the total.
    const again = update({ ref: 'HG-1 renamed' }, result.feature)
    expect(again.feature.units).toBe(unitsAt(LENGTH_KM))
    expect(again.unitsTotals.hedgerowsTotal).toBe(unitsAt(LENGTH_KM))
  })

  test('a BNG Service template hedgerow that names no parent is priced by its new ref when renamed, as later re-derives price it', () => {
    // A template row that names no parent finds none by its old ref. The
    // baseline hedgerow carrying its old ref must not price the rename.
    const template = {
      ...feature,
      templateTable: 'Hedgerows'
    }
    const result = applyFeatureUpdate(
      {
        baseline: { hedgerows: [baselineHedgerow] },
        postIntervention: { template: 'bng-service', hedgerows: [template] }
      },
      {
        featureId,
        edits: { ...edits, ref: 'HG-1 renamed' },
        documentKey: 'postIntervention',
        expectedType: 'hedgerow',
        baseline: { hedgerows: [baselineHedgerow] }
      }
    )
    expect(result.status).toBe('ok')
    expect(result.feature).toMatchObject({
      ref: 'HG-1 renamed',
      referenceEdited: true,
      units: 0,
      status: 'Incomplete'
    })
    expect(result.feature).not.toHaveProperty('parentFeatureId')
  })

  test.each([
    [
      'the baseline condition again',
      { habitatType: 'Native hedgerow', condition: 'Moderate' }
    ],
    [
      'a type move G-6 does not allow',
      { habitatType: 'Line of trees', condition: 'Good' }
    ],
    ['an unknown habitat type', { habitatType: 'Nope', condition: 'Good' }]
  ])('the route refuses %s before any write', async (_name, overrides) => {
    await expect(
      updatePostInterventionHedgerow.handler(
        request({ ...edits, ...overrides })
      )
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: { code: 'ENHANCEMENT_NOT_VALID', rule: 'offered-enhancement' }
      }
    })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('an omitted habitat type and condition keep the stored ones, unchecked', () => {
    // The stored Good is no longer offered once the baseline is Good itself.
    const stored = { ...feature, baseline: { ...baseline, condition: 'Good' } }
    const { habitatType: _type, condition: _condition, ...kept } = edits
    expect(
      validateCreatedHedgerowEdit(stored, { ...kept, ref: 'HG-1 renamed' })
    ).toMatchObject({ habitatType: 'Native hedgerow', condition: 'Good' })
  })

  test('the route saves an edit and returns the saved hedgerow', async () => {
    const saved = await updatePostInterventionHedgerow.handler(request(edits))
    expect(saved).toMatchObject({
      status: 'Complete',
      proposed: { type: 'Species-rich native hedgerow', condition: 'Moderate' }
    })
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({ feature: saved })
    )
  })

  test('a Created hedgerow still chooses from the creation list, refused as a bad request', () => {
    expect(() =>
      validateCreatedHedgerowEdit(
        { ...feature, retentionCategory: 'Created' },
        { ...edits, habitatType: 'Nope' }
      )
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 })
      })
    )
  })

  test('a Retained hedgerow still cannot take the complete edit', () => {
    expect(() =>
      validateCreatedHedgerowEdit(
        { ...feature, retentionCategory: 'Retained' },
        edits
      )
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 })
      })
    )
  })

  test('a rename shared by two baseline hedgerows is priced against the one it records as its parent', () => {
    // Both baseline hedgerows carry the old ref. The stored baseline snapshot
    // names the first (Moderate); the second, half as long, is Poor and comes
    // last, so a join by ref alone would take its length.
    const shorter = {
      ...baselineHedgerow,
      featureId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      sizeMetres: SIZE_METRES / 2,
      condition: 'Poor'
    }
    const result = update({ ref: 'HG-1 renamed' }, feature, [
      baselineHedgerow,
      shorter
    ])

    expect(result.feature).toMatchObject({
      parentFeatureId: baselineHedgerow.featureId,
      units: unitsAt(LENGTH_KM)
    })
    // Saving it again, now by its parent, keeps the same units.
    const again = update({ ref: 'HG-1 renamed' }, result.feature, [
      baselineHedgerow,
      shorter
    ])
    expect(again.feature.units).toBe(result.feature.units)
  })

  test('a hedgerow renamed with no baseline parent is not priced against a baseline that shares its new ref', () => {
    // An earlier rename found no baseline hedgerow by its old ref, so it
    // recorded an explicit null parent. Its new ref matches an unrelated
    // baseline hedgerow, which must not price it.
    const unrelated = { ...baselineHedgerow, ref: 'HG-1 renamed' }
    const renamed = {
      ...feature,
      ref: 'HG-1 renamed',
      referenceEdited: true,
      parentFeatureId: null
    }
    const result = update({ ref: 'HG-1 renamed' }, renamed, [unrelated])

    expect(result.status).toBe('ok')
    expect(result.feature).toMatchObject({
      parentFeatureId: null,
      units: 0,
      status: 'Incomplete'
    })
  })

  test('a rename that sends back a stored proposal its unreadable baseline does not list is saved', async () => {
    // A baseline with no condition offers nothing, so the stored proposal is
    // not listed; sending it back unchanged must not refuse it.
    const stored = { ...feature, baseline: { ...baseline, condition: null } }
    const saved = await updatePostInterventionHedgerow.handler(
      request(
        {
          ...edits,
          ref: 'HG-1 renamed',
          habitatType: stored.proposed.type,
          condition: stored.proposed.condition
        },
        stored
      )
    )
    expect(saved).toMatchObject({
      ref: 'HG-1 renamed',
      proposed: { type: 'Native hedgerow', condition: 'Good' }
    })
  })

  test('a kept proposal that no longer enhances a readable baseline is refused by the enhancement rule', async () => {
    // The baseline was edited up to Good, the stored proposal's own
    // condition. Resent unchanged, the kept type and condition pass the
    // offered-choice check, and the recomputed feature is refused.
    const stored = { ...feature, baseline: { ...baseline, condition: 'Good' } }
    await expect(
      updatePostInterventionHedgerow.handler(
        request(
          {
            ...edits,
            habitatType: stored.proposed.type,
            condition: stored.proposed.condition
          },
          stored
        )
      )
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          code: 'ENHANCEMENT_NOT_VALID',
          rule: expect.not.stringMatching(/^offered-enhancement$/)
        }
      }
    })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('a stored condition is kept only under its stored habitat type', () => {
    // Poor is stored, and Species-rich native hedgerow does not list it.
    // Sending Poor back under that new type is a changed choice, so the
    // offered-choice check refuses it, before any enhancement rule.
    const stored = {
      ...feature,
      proposed: { ...feature.proposed, condition: 'Poor' }
    }
    expect(() =>
      validateCreatedHedgerowEdit(stored, {
        ...edits,
        habitatType: 'Species-rich native hedgerow',
        condition: 'Poor'
      })
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 422,
          payload: expect.objectContaining({ rule: 'offered-enhancement' })
        })
      })
    )
    // Under its stored type, the same condition is kept.
    expect(
      validateCreatedHedgerowEdit(stored, {
        ...edits,
        habitatType: 'Native hedgerow',
        condition: 'Poor'
      })
    ).toMatchObject({ habitatType: 'Native hedgerow', condition: 'Poor' })
  })
})
