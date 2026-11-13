import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  calculateEnhancedAreaHabitatPostIntervention,
  HABITAT_DIFFICULTY
} from 'bng-library/metric'
import { getAreaEnhancementReference } from '../validation/reference/area-enhancement.js'
import { getAreaCreationReference } from '../validation/reference/area-creation.js'
import {
  checkFeatureEnhancement,
  enhancementTarget
} from '../validation/geopackage/post-intervention/enhancement-rules.js'
import { postInterventionHabitatSchema } from '../validation/post-intervention/project-post-intervention-schema.js'
import { applyFeatureUpdate } from '../utilities/features/apply-feature-update.js'
import { updatePostInterventionAreaHabitat } from './habitats.js'
import { validateCreatedAreaEdit } from './created-area-edit.js'
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

function routeRequest(payload, stored = feature) {
  const row = { project: { postIntervention: { habitats: [stored] } } }
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
    await expect(
      updatePostInterventionAreaHabitat.handler(
        routeRequest({ ...edits, ...overrides }),
        {}
      )
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
    expect(setProjectFeature).not.toHaveBeenCalled()
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
      validateCreatedAreaEdit(
        { ...feature, retentionCategory: 'Retained' },
        edits
      )
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 })
      })
    )
  })

  test('an Enhanced area with no stored baseline is offered nothing, so any choice is refused', () => {
    const { baseline: _omitted, ...withoutBaseline } = feature
    expect(() => validateCreatedAreaEdit(withoutBaseline, edits)).toThrow(
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

  // Fills the cache with 501 baselines, each read against every habitat.
  test('the per-baseline cache starts again once full, and still answers correctly', () => {
    const expected = getAreaEnhancementReference(baseline)
    for (let i = 0; i <= 500; i++) {
      getAreaEnhancementReference({ broadType: 'Nope', type: `Unknown ${i}` })
    }
    expect(getAreaEnhancementReference(baseline)).toEqual(expected)
  }, 30_000)
})
