import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  calculateCreatedHedgerowPostIntervention,
  roundToSigFigs
} from 'bng-library/metric'
import { getHedgerowCreationReference } from '../validation/reference/hedgerow-creation.js'
import {
  postInterventionHedgerowEditPayload,
  validateCreatedHedgerowEdit
} from './created-hedgerow-edit.js'
import { applyFeatureUpdate } from '../utilities/features/apply-feature-update.js'
import { updatePostInterventionHedgerow } from './habitats.js'
import { setProjectFeature } from '../db/persist-project.js'
import { setGeometryRefs } from '../db/feature-geometry-refs.js'
import { postInterventionLinearHabitatSchema } from '../validation/post-intervention/project-post-intervention-schema.js'
vi.mock('../db/persist-project.js', () => ({ setProjectFeature: vi.fn() }))
vi.mock('../db/feature-geometry-refs.js', () => ({ setGeometryRefs: vi.fn() }))
const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const feature = {
  featureId,
  ref: 'H-1',
  retentionCategory: 'Created',
  sizeMetres: 336,
  units: 1,
  status: 'Complete',
  baseline: {},
  proposed: { type: 'Native hedgerow', condition: 'Poor' }
}
const edits = {
  ref: 'New hedge',
  habitatType: 'Native hedgerow',
  condition: 'Good',
  strategicSignificance: 'High',
  advanceYears: 0,
  delayYears: 0
}
function update(overrides = {}) {
  return applyFeatureUpdate(
    {
      postIntervention: {
        hedgerows: [
          feature,
          {
            ...feature,
            featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            units: 4
          }
        ]
      }
    },
    {
      featureId,
      edits: { ...edits, ...overrides },
      documentKey: 'postIntervention',
      expectedType: 'hedgerow'
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
              { project: { postIntervention: { hedgerows: [stored] } } }
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
beforeEach(() => vi.clearAllMocks())
describe('BMD-1049 Created hedgerow edits', () => {
  test('reference has only hedgerows and conditions supported by the public engine', () => {
    const reference = getHedgerowCreationReference()
    expect(reference.featureType).toBe('hedgerow')
    expect(reference.habitatTypes.length).toBeGreaterThan(0)
    for (const type of reference.habitatTypes) {
      expect(type).not.toHaveProperty('broad')
      for (const c of type.conditions) {
        const metrics = calculateCreatedHedgerowPostIntervention(
          1,
          type.name,
          c.condition,
          0,
          0,
          'Low'
        )
        expect(String(c.years)).toBe(
          String(metrics.standardTimeToTargetCondition).replace('>30', '30+')
        )
        expect(type.difficulty).toBe(metrics.difficulty)
      }
    }
    reference.habitatTypes.length = 0
    expect(getHedgerowCreationReference().habitatTypes.length).toBeGreaterThan(
      0
    )
  })
  test('recalculates units and hedgerow totals while retaining imported length and intervention', () => {
    const result = update()
    const expected = calculateCreatedHedgerowPostIntervention(
      0.336,
      edits.habitatType,
      edits.condition,
      0,
      0,
      'High'
    )
    expect(result.feature).toMatchObject({
      ref: 'New hedge',
      sizeMetres: 336,
      retentionCategory: 'Created',
      units: expected.units,
      status: 'Complete',
      proposed: {
        type: 'Native hedgerow',
        condition: 'Good',
        advanceYears: 0,
        delayYears: 0,
        difficulty: expected.difficulty,
        difficultyMultiplier: expected.difficultyMultiplier,
        strategicSignificanceScore: 1.15
      }
    })
    expect(result.unitsTotals.hedgerowsTotal).toBeCloseTo(
      roundToSigFigs(expected.units + 4)
    )
    expect(feature.ref).toBe('H-1')
    expect(
      postInterventionLinearHabitatSchema.validate(result.feature).error
    ).toBeUndefined()
  })
  test.each([
    'habitatType',
    'condition',
    'strategicSignificance',
    'advanceYears',
    'delayYears'
  ])('null %s is Incomplete with zero contribution', (field) => {
    const overrides = { [field]: null }
    if (field === 'habitatType') {
      overrides.condition = null
    }
    const result = update(overrides)
    expect(result.feature.status).toBe('Incomplete')
    expect(result.feature.units).toBe(0)
    expect(result.unitsTotals.hedgerowsTotal).toBe(4)
  })
  test.each([
    { advanceYears: 30, delayYears: 0 },
    { advanceYears: 0, delayYears: '30+' }
  ])('handles timing %j and persists valid years', (timing) => {
    const result = update(timing)
    expect(result.feature.status).toBe('Complete')
    expect(
      postInterventionLinearHabitatSchema.validate(result.feature).error
    ).toBeUndefined()
    if (timing.delayYears === '30+') {
      expect(result.feature.proposed).toMatchObject({
        delayYears: 30,
        delayYearsIs30Plus: true
      })
    }
  })
  test.each([
    { ref: ' ' },
    { ref: '\uFFFD' },
    { advanceYears: 1, delayYears: 1 },
    { habitatType: 'Modified grassland' },
    { condition: 'Fairly Good' }
  ])('rejects invalid edits %j', (invalid) => {
    expect(() =>
      validateCreatedHedgerowEdit(feature, { ...edits, ...invalid })
    ).toThrow()
  })
  test.each(['Retained', 'Enhanced', 'Lost'])(
    'rejects extended edits to %s hedgerows',
    (retentionCategory) => {
      expect(() =>
        validateCreatedHedgerowEdit({ ...feature, retentionCategory }, edits)
      ).toThrow()
    }
  )
  test('schema requires all fields, accepts null and zero, rejects invalid years and fixed fields', () => {
    expect(
      postInterventionHedgerowEditPayload.validate(edits).error
    ).toBeUndefined()
    for (const field of [
      'habitatType',
      'condition',
      'strategicSignificance',
      'advanceYears',
      'delayYears'
    ]) {
      expect(
        postInterventionHedgerowEditPayload.validate({
          ...edits,
          [field]: null
        }).error
      ).toBeUndefined()
      const missing = { ...edits }
      delete missing[field]
      expect(
        postInterventionHedgerowEditPayload.validate(missing).error
      ).toBeDefined()
    }
    for (const invalid of [
      { advanceYears: -1 },
      { delayYears: 31 },
      { broadType: 'Grassland' },
      { sizeMetres: 1 },
      { units: 999 }
    ]) {
      expect(
        postInterventionHedgerowEditPayload.validate({ ...edits, ...invalid })
          .error
      ).toBeDefined()
    }
  })
  test('route persists feature, totals, trading rules and geometry reference with verified actor', async () => {
    const result = await updatePostInterventionHedgerow.handler(request(edits))
    expect(result.ref).toBe('New hedge')
    expect(setProjectFeature).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.objectContaining({
        documentKey: 'postIntervention',
        layer: 'hedgerows',
        feature: result,
        actorId: 'test-user',
        unitsTotals: expect.anything(),
        tradingRules: expect.anything()
      })
    )
    expect(setGeometryRefs).toHaveBeenCalled()
  })
  test('validation fails before any persistence', async () => {
    await expect(
      updatePostInterventionHedgerow.handler(
        request({ ...edits, advanceYears: 1, delayYears: 1 })
      )
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
    expect(setProjectFeature).not.toHaveBeenCalled()
    expect(setGeometryRefs).not.toHaveBeenCalled()
  })
})

test('saves independently derived fields when strategic significance or timing is null', () => {
  const timingMissing = update({ delayYears: null }).feature.proposed
  expect(timingMissing).toMatchObject({
    distinctiveness: 'Low',
    difficulty: 'Low',
    difficultyMultiplier: 1,
    standardTimeToTargetCondition: '12',
    finalTimeToTargetCondition: null
  })
  const significanceMissing = update({ strategicSignificance: null }).feature
    .proposed
  expect(significanceMissing.finalTimeToTargetCondition).toContain('12 years')
})
