import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  calculateEnhancedAreaHabitatPostIntervention,
  HABITAT_DIFFICULTY
} from 'bng-library/metric'
import {
  _areaEnhancementCacheSize,
  getAreaEnhancementReference
} from '../validation/reference/area-enhancement.js'
import { getAreaCreationReference } from '../validation/reference/area-creation.js'
import {
  checkFeatureEnhancement,
  enhancementTarget
} from '../validation/geopackage/post-intervention/enhancement-rules.js'
import { postInterventionHabitatSchema } from '../validation/post-intervention/project-post-intervention-schema.js'
import { applyFeatureUpdate } from '../utilities/features/apply-feature-update.js'
import { updatePostInterventionAreaHabitat } from './habitats.js'
import { validatePostInterventionAreaEdit } from './post-intervention-area-edit.js'
import { getAreaEnhancement } from './reference.js'
import { setProjectFeature } from '../db/persist-project.js'

vi.mock('../db/persist-project.js', () => ({
  setProjectFeature: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../db/feature-geometry-refs.js', () => ({
  setGeometryRefs: vi.fn().mockResolvedValue(undefined)
}))

const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const baseline = {
  broadType: 'Grassland',
  type: 'Modified grassland',
  condition: 'Poor'
}
const feature = {
  featureId,
  ref: 'E-1',
  retentionCategory: 'Enhanced',
  sizeSquareMetres: 25000,
  units: 3,
  status: 'Complete',
  baseline,
  proposed: {
    broadType: 'Grassland',
    type: 'Modified grassland',
    condition: 'Fairly Poor',
    strategicSignificance: 'Low',
    advanceYears: 0,
    delayYears: 0
  }
}
const edits = {
  ref: 'Enhanced reference',
  broadType: 'Grassland',
  habitatType: 'Modified grassland',
  condition: 'Moderate',
  strategicSignificance: 'High',
  advanceYears: 0,
  delayYears: 2
}

function update(overrides = {}, stored = feature) {
  return applyFeatureUpdate(
    { postIntervention: { habitats: [stored] } },
    {
      featureId,
      edits: { ...edits, ...overrides },
      documentKey: 'postIntervention',
      expectedType: 'habitat'
    }
  )
}

function routeRequest(payload, stored = feature, baselineDocument) {
  const row = {
    project: {
      ...(baselineDocument ? { baseline: baselineDocument } : {}),
      postIntervention: { habitats: [stored] }
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

describe('BMD-1045 area enhancement reference', () => {
  const reference = getAreaEnhancementReference(baseline)

  test('offers only valid enhancements of the baseline, each with its enhancement time to target', () => {
    expect(reference.habitatTypes.length).toBeGreaterThan(0)
    for (const type of reference.habitatTypes) {
      expect(type.conditions.length).toBeGreaterThan(0)
      for (const { condition, years } of type.conditions) {
        expect(
          checkFeatureEnhancement('habitats', {
            baseline,
            proposed: { broadType: type.broad, type: type.name, condition }
          })
        ).toMatchObject({ valid: true })
        expect(years === '30+' || Number.isInteger(years)).toBe(true)
      }
    }
  })

  test('leaves out every target that is not a valid enhancement', () => {
    const creation = getAreaCreationReference()
    const offered = new Set(
      reference.habitatTypes.flatMap((t) =>
        t.conditions.map((c) => `${t.broad}|${t.name}|${c.condition}`)
      )
    )
    const modified = reference.habitatTypes.find(
      (t) => t.name === 'Modified grassland'
    )
    // Poor is the baseline's own condition, so not an enhancement of it.
    expect(modified.conditions.map((c) => c.condition)).not.toContain('Poor')
    expect(modified.conditions).toContainEqual(
      expect.objectContaining({ condition: 'Moderate', years: 10 })
    )
    // A Very Low baseline-only habitat (Cropland is Low; Urban Artificial
    // unvegetated is V.Low) cannot be the target of a Low baseline.
    expect(
      offered.has('Urban|Artificial unvegetated, unsealed surface|N/A - Other')
    ).toBe(false)
    const broadsOffered = new Set(reference.habitatTypes.map((t) => t.broad))
    expect(broadsOffered.size).toBeLessThan(
      new Set(creation.habitatTypes.map((t) => t.broad)).size
    )
  })

  test('offers a Medium baseline only the Medium grassland types, in better condition, with their enhancement times', () => {
    const medium = getAreaEnhancementReference({
      broadType: 'Grassland',
      type: 'Other neutral grassland',
      condition: 'Moderate'
    })
    const targets = [
      { condition: 'Good', years: 10 },
      { condition: 'Fairly Good', years: 8 }
    ]
    expect(
      medium.habitatTypes.map((t) => ({
        broad: t.broad,
        name: t.name,
        conditions: t.conditions.map(({ condition, years }) => ({
          condition,
          years
        }))
      }))
    ).toEqual(
      [
        'Other lowland acid grassland',
        'Other neutral grassland',
        'Upland acid grassland'
      ].map((name) => ({ broad: 'Grassland', name, conditions: targets }))
    )
  })

  test('offers a Very Low baseline habitats across broad habitats, with their enhancement times', () => {
    const veryLow = getAreaEnhancementReference({
      broadType: 'Urban',
      type: 'Artificial unvegetated, unsealed surface',
      condition: 'N/A - Other'
    })
    expect(
      [...new Set(veryLow.habitatTypes.map((t) => t.broad))].sort()
    ).toEqual([
      'Grassland',
      'Heathland and shrub',
      'Lakes',
      'Sparsely vegetated land',
      'Urban',
      'Woodland and forest'
    ])
    const timesOf = (name) =>
      Object.fromEntries(
        veryLow.habitatTypes
          .find((t) => t.name === name)
          .conditions.map((c) => [c.condition, c.years])
      )
    expect(timesOf('Modified grassland')).toEqual({
      Good: 15,
      'Fairly Good': 12,
      Moderate: 10,
      'Fairly Poor': 5,
      Poor: 1
    })
    expect(timesOf('Mixed scrub')).toEqual({
      Good: 10,
      'Fairly Good': 7,
      Moderate: 5,
      'Fairly Poor': 3,
      Poor: 1
    })
  })

  test('carries the enhancement difficulty, not the creation one', () => {
    const type = reference.habitatTypes.find(
      (t) => t.name === 'Modified grassland'
    )
    expect(type.difficulty).toBe(
      HABITAT_DIFFICULTY['Grassland - Modified grassland'].Enhancement
    )
    expect(type.difficultyMultiplier).toEqual(expect.any(Number))
    expect(reference.strategicSignificance).toEqual(
      getAreaCreationReference().strategicSignificance
    )
    expect(reference.timeMultipliers).toEqual(
      getAreaCreationReference().timeMultipliers
    )
  })

  test('is empty for a baseline that cannot be enhanced or is not known', () => {
    expect(
      getAreaEnhancementReference({
        broadType: 'Grassland',
        type: 'Modified grassland',
        condition: 'Good'
      }).habitatTypes.find((t) => t.name === 'Modified grassland')
    ).toBeUndefined()
    expect(getAreaEnhancementReference({}).habitatTypes).toEqual([])
    expect(
      getAreaEnhancementReference({ broadType: 'Nope', type: 'Nope' })
        .habitatTypes
    ).toEqual([])
  })

  test('callers cannot mutate the cached reference', () => {
    const first = getAreaEnhancementReference(baseline)
    first.habitatTypes.length = 0
    expect(
      getAreaEnhancementReference(baseline).habitatTypes.length
    ).toBeGreaterThan(0)
  })

  test('the route reads the baseline from the query', () => {
    expect(getAreaEnhancement.handler({ query: baseline }, {})).toEqual(
      reference
    )
  })
})

describe('BMD-1045 Enhanced area edits', () => {
  beforeEach(() => vi.clearAllMocks())

  test('AC12 Scenario A: a complete edit saves its values, the derived values and the enhanced units', () => {
    const result = update()
    expect(result.status).toBe('ok')
    const expected = calculateEnhancedAreaHabitatPostIntervention(
      2.5,
      'Grassland - Modified grassland',
      'Grassland - Modified grassland',
      'Poor',
      'Moderate',
      0,
      2,
      'High'
    )
    expect(result.feature).toMatchObject({
      ref: 'Enhanced reference',
      retentionCategory: 'Enhanced',
      status: 'Complete',
      units: expected.units,
      baseline,
      proposed: {
        broadType: 'Grassland',
        type: 'Modified grassland',
        condition: 'Moderate',
        strategicSignificance: 'High',
        advanceYears: 0,
        delayYears: 2
      }
    })
    expect(result.feature.proposed.standardTimeToTargetCondition).toContain(
      '10'
    )
    expect(result.feature.proposed.finalTimeToTargetCondition).toContain('12')
    expect(result.feature.proposed.difficulty).toBe(
      HABITAT_DIFFICULTY['Grassland - Modified grassland'].Enhancement
    )
    expect(result.unitsTotals).toBeDefined()
    expect(
      postInterventionHabitatSchema.validate(result.feature).error
    ).toBeUndefined()
  })

  test.each([
    ['strategic significance', { strategicSignificance: null }],
    ['target condition', { condition: null }],
    ['habitat type', { habitatType: null, condition: null }],
    ['broad habitat', { broadType: null, habitatType: null, condition: null }],
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
      expect(
        postInterventionHabitatSchema.validate(result.feature).error
      ).toBeUndefined()
    }
  )

  test('the route saves an edit and records the authenticated actor', async () => {
    const saved = await updatePostInterventionAreaHabitat.handler(
      routeRequest(edits),
      {}
    )
    expect(saved).toMatchObject({ status: 'Complete', ref: edits.ref })
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({ feature: saved, actorId: 'test-user' })
    )
  })

  test.each([
    ['the baseline condition again', { condition: 'Poor' }],
    [
      'a habitat type that is not an enhancement of the baseline',
      {
        broadType: 'Urban',
        habitatType: 'Artificial unvegetated, unsealed surface',
        condition: 'N/A - Other'
      }
    ],
    ['an unknown broad habitat', { broadType: 'Nope' }]
  ])('the route refuses %s before any write', async (_name, overrides) => {
    // ENHANCEMENT_NOT_VALID, so the edit form can show it against the target
    // condition, as for a page loaded before its baseline was edited.
    await expect(
      updatePostInterventionAreaHabitat.handler(
        routeRequest({ ...edits, ...overrides }),
        {}
      )
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: { code: 'ENHANCEMENT_NOT_VALID', rule: 'offered-enhancement' }
      }
    })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test('a rename keeps a stored proposal the edit form no longer offers', () => {
    // A baseline the rules cannot read offers nothing, so its stored
    // proposal is not listed; sending it back unchanged must not refuse or
    // clear it. Every stored value is one persistence accepts.
    const unread = {
      ...feature,
      // An incomplete baseline, with no condition the rules can read, as
      // persistence would store it.
      baseline: { ...baseline, condition: null }
    }
    const kept = {
      ...edits,
      broadType: unread.proposed.broadType,
      habitatType: unread.proposed.type,
      condition: unread.proposed.condition
    }
    expect(validatePostInterventionAreaEdit(unread, kept)).toMatchObject({
      broadType: 'Grassland',
      habitatType: 'Modified grassland',
      condition: 'Fairly Poor'
    })
  })

  test('a rename that keeps a proposal its improved baseline makes invalid is refused by the enhancement rule', async () => {
    // The baseline was edited up to Moderate after a Moderate proposal was
    // saved, so the proposal is no longer an enhancement of it and the list
    // does not offer it.
    const stored = {
      ...feature,
      baseline: { ...baseline, condition: 'Moderate' },
      proposed: { ...feature.proposed, condition: 'Moderate' }
    }
    await expect(
      updatePostInterventionAreaHabitat.handler(
        routeRequest(
          { ...edits, ref: 'Renamed', condition: 'Moderate' },
          stored
        ),
        {}
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

  test('a rename keeps a stored proposal the edit form no longer offers, end to end', async () => {
    const unread = {
      ...feature,
      // An incomplete baseline, with no condition the rules can read, as
      // persistence would store it.
      baseline: { ...baseline, condition: null }
    }
    await updatePostInterventionAreaHabitat.handler(
      routeRequest(
        {
          ...edits,
          ref: 'Renamed',
          broadType: unread.proposed.broadType,
          habitatType: unread.proposed.type,
          condition: unread.proposed.condition
        },
        unread
      ),
      {}
    )
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({
        feature: expect.objectContaining({
          ref: 'Renamed',
          proposed: expect.objectContaining({
            broadType: 'Grassland',
            type: 'Modified grassland',
            condition: 'Fairly Poor'
          })
        })
      })
    )
  })

  const iggi = {
    broadType: 'Intertidal hard structures',
    type: 'Artificial hard structures with integrated greening of grey infrastructure (IGGI)',
    condition: 'Good'
  }

  test('a rename keeps a stored IGGI proposal the library accepts as an enhancement', async () => {
    // Littoral sand at Moderate can be enhanced to an IGGI in Good condition,
    // and an import keeps that proposal, though neither edit list offers IGGI.
    const stored = {
      ...feature,
      baseline: {
        broadType: 'Intertidal sediment',
        type: 'Littoral sand',
        condition: 'Moderate'
      },
      proposed: { ...feature.proposed, ...iggi }
    }
    await updatePostInterventionAreaHabitat.handler(
      routeRequest(
        {
          ...edits,
          ref: 'Renamed',
          broadType: iggi.broadType,
          habitatType: iggi.type,
          condition: iggi.condition
        },
        stored
      ),
      {}
    )
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({
        feature: expect.objectContaining({
          ref: 'Renamed',
          proposed: expect.objectContaining({
            broadType: iggi.broadType,
            type: iggi.type,
            condition: iggi.condition
          })
        })
      })
    )
  })

  test('a Created area cannot keep a stored IGGI habitat type, which the creation list does not offer', () => {
    const stored = {
      ...feature,
      retentionCategory: 'Created',
      proposed: { ...feature.proposed, ...iggi }
    }
    expect(() =>
      validatePostInterventionAreaEdit(stored, {
        ...edits,
        broadType: iggi.broadType,
        habitatType: iggi.type,
        condition: iggi.condition
      })
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 })
      })
    )
  })

  test('a complete edit to another habitat type saves its enhanced units, totals and trading rules', async () => {
    await updatePostInterventionAreaHabitat.handler(
      routeRequest({
        ...edits,
        habitatType: 'Other neutral grassland',
        condition: 'Moderate'
      }),
      {}
    )
    const expected = calculateEnhancedAreaHabitatPostIntervention(
      2.5,
      'Grassland - Modified grassland',
      'Grassland - Other neutral grassland',
      'Poor',
      'Moderate',
      0,
      2,
      'High'
    )
    const [, , saved] = vi.mocked(setProjectFeature).mock.calls[0]
    expect(saved.feature).toMatchObject({
      status: 'Complete',
      units: expected.units,
      proposed: {
        broadType: 'Grassland',
        type: 'Other neutral grassland',
        condition: 'Moderate',
        distinctiveness: 'Medium',
        difficulty:
          HABITAT_DIFFICULTY['Grassland - Other neutral grassland'].Enhancement
      }
    })
    expect(saved.unitsTotals.habitatsTotal).toBe(expected.units)
    expect(saved.tradingRules.areaHabitats.habitatTypes).toEqual([
      expect.objectContaining({
        habitatType: 'Grassland - Other neutral grassland',
        distinctiveness: 'Medium',
        netUnitChange: expected.units
      })
    ])
  })

  test('a rename through the route records the parent it was renamed from', async () => {
    const baselineHabitat = {
      featureId: 'baseline-h1',
      ref: 'E-1',
      ...baseline,
      sizeSquareMetres: 25000,
      area: 25000
    }
    await updatePostInterventionAreaHabitat.handler(
      routeRequest({ ...edits, ref: 'E-1 renamed' }, feature, {
        habitats: [baselineHabitat]
      }),
      {}
    )
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({
        feature: expect.objectContaining({
          ref: 'E-1 renamed',
          referenceEdited: true,
          parentFeatureId: 'baseline-h1'
        })
      })
    )
  })

  test('a kept condition under a changed habitat type is checked against the list', () => {
    // Modified grassland does not list Poor, the baseline's own condition, as
    // a target, though Other neutral grassland does.
    const stored = {
      ...feature,
      proposed: {
        ...feature.proposed,
        type: 'Other neutral grassland',
        condition: 'Poor'
      }
    }
    expect(() =>
      validatePostInterventionAreaEdit(stored, {
        ...edits,
        habitatType: 'Modified grassland',
        condition: 'Poor'
      })
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 422 })
      })
    )
  })

  test('AC14: the route refuses both an advance and a delay above zero', async () => {
    await expect(
      updatePostInterventionAreaHabitat.handler(
        routeRequest({ ...edits, advanceYears: 1, delayYears: 1 }),
        {}
      )
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
    expect(setProjectFeature).not.toHaveBeenCalled()
  })

  test.each([
    ['hedgerows', 'Enhanced'],
    ['watercourses', 'Enhanced'],
    ['habitats', 'Retained']
  ])(
    'the full edit is still refused on %s that are %s',
    (layer, retentionCategory) => {
      const project = {
        postIntervention: { [layer]: [{ ...feature, retentionCategory }] }
      }
      const result = applyFeatureUpdate(project, {
        featureId,
        documentKey: 'postIntervention',
        edits
      })
      expect(result.status).toBe('unsupportedType')
    }
  )
})

describe('BMD-1045 edge cases', () => {
  test('the area edit refuses a feature that is neither Created nor Enhanced', () => {
    expect(() =>
      validatePostInterventionAreaEdit(
        { ...feature, retentionCategory: 'Retained' },
        edits
      )
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 })
      })
    )
  })

  test('an Enhanced area with no stored baseline is offered nothing, so any new choice is refused', () => {
    const { baseline: _omitted, ...withoutBaseline } = feature
    expect(() =>
      validatePostInterventionAreaEdit(withoutBaseline, edits)
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 422 })
      })
    )
  })

  test('a Created area’s refused choice is still a bad request', () => {
    expect(() =>
      validatePostInterventionAreaEdit(
        { ...feature, retentionCategory: 'Created' },
        { ...edits, broadType: 'Nope' }
      )
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 })
      })
    )
  })

  test('enhancementTarget is not valid for a layer the rules do not cover, or a baseline they cannot read', () => {
    const proposed = {
      broadType: 'Grassland',
      type: 'Modified grassland',
      condition: 'Good'
    }
    expect(enhancementTarget('trees', { baseline, proposed })).toEqual({
      valid: false,
      timeToTarget: null
    })
    expect(
      enhancementTarget('habitats', { baseline: { type: 'Nope' }, proposed })
    ).toEqual({ valid: false, timeToTarget: null })
    expect(enhancementTarget('habitats', { baseline, proposed })).toEqual({
      valid: true,
      timeToTarget: expect.anything()
    })
  })

  test('a baseline the rules cannot read is offered nothing and not cached', () => {
    const before = _areaEnhancementCacheSize()
    for (const unread of [
      { broadType: 'Nope', type: 'Unknown', condition: 'Poor' },
      { ...baseline, condition: 'Not a condition' },
      { ...baseline, condition: null }
    ]) {
      expect(getAreaEnhancementReference(unread).habitatTypes).toEqual([])
    }
    expect(_areaEnhancementCacheSize()).toBe(before)
  })

  test('the same baseline read two ways shares one cached answer', () => {
    const expected = getAreaEnhancementReference(baseline)
    const size = _areaEnhancementCacheSize()
    expect(
      getAreaEnhancementReference({ ...baseline, condition: '1. Poor' })
    ).toEqual(expected)
    expect(_areaEnhancementCacheSize()).toBe(size)
  })
})
