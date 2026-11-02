import {
  resyncPostInterventionBaselineSide,
  rederivePostInterventionFromBaseline
} from '../utilities/enrichment/post-intervention/resync-post-intervention-baseline.js'
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
    expect(result.feature.units).toBeNull()
    expect(result.unitsTotals.hedgerowsTotal).toBe(4)
  })
  test.each([
    { advanceYears: 2, delayYears: 0 },
    { advanceYears: 0, delayYears: 3 },
    { advanceYears: 30, delayYears: 0 },
    { advanceYears: 0, delayYears: '30+' }
  ])('handles timing %j and persists valid years', (timing) => {
    const result = update(timing)
    expect(result.feature.status).toBe('Complete')
    const expected = calculateCreatedHedgerowPostIntervention(
      0.336,
      edits.habitatType,
      edits.condition,
      timing.advanceYears,
      timing.delayYears,
      edits.strategicSignificance
    )
    expect(result.feature.units).toBe(expected.units)
    expect(result.feature.proposed.timeMultiplier).toBe(expected.timeMultiplier)
    expect(result.unitsTotals.hedgerowsTotal).toBeCloseTo(
      roundToSigFigs(expected.units + 4)
    )
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
  test('schema requires editable attributes and allows timing omission, but rejects invalid new years', () => {
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
      const error = postInterventionHedgerowEditPayload.validate(missing).error
      if (['advanceYears', 'delayYears', 'condition'].includes(field)) {
        expect(error).toBeUndefined()
      } else {
        expect(error).toBeDefined()
      }
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
  test('normalises legacy Created retention before persisting a hedgerow edit', async () => {
    const stored = structuredClone(feature)
    delete stored.retentionCategory
    stored.baseline.retentionCategory = 'Created'
    setProjectFeature.mockImplementationOnce((_tx, _id, { feature: saved }) => {
      expect(
        postInterventionLinearHabitatSchema.validate(saved).error
      ).toBeUndefined()
    })
    const result = await updatePostInterventionHedgerow.handler(
      request(edits, stored)
    )
    expect(result.retentionCategory).toBe('Created')
    expect(result.baseline).not.toHaveProperty('retentionCategory')
    expect(stored.baseline.retentionCategory).toBe('Created')
    expect(setProjectFeature).toHaveBeenCalledOnce()
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

test.each(['condition', 'strategicSignificance', 'advanceYears', 'delayYears'])(
  'incomplete %s has the same persisted shape after a baseline resync',
  (field) => {
    const saved = update({ [field]: null }).feature
    const rederived = rederivePostInterventionFromBaseline(
      { hedgerows: [saved] },
      { baseline: {} }
    ).hedgerows[0]
    for (const row of [saved, rederived]) {
      expect(row).toMatchObject({
        units: null,
        status: 'Incomplete',
        proposed: {
          distinctiveness: null,
          difficulty: null,
          difficultyMultiplier: null,
          standardTimeToTargetCondition: null,
          finalTimeToTargetCondition: null
        }
      })
      expect(row.proposed[field]).toBeNull()
    }
  }
)

test.each([2.5, 31])(
  'omitted timing retains the stored %s without allowing it as a new value',
  async (advanceYears) => {
    const payload = { ...edits }
    delete payload.advanceYears
    const stored = {
      ...feature,
      proposed: { ...feature.proposed, advanceYears, delayYears: 0 }
    }
    const result = await updatePostInterventionHedgerow.handler(
      request(payload, stored)
    )
    expect(result.proposed.advanceYears).toBe(advanceYears)
    expect(
      postInterventionHedgerowEditPayload.validate({ ...edits, advanceYears })
        .error
    ).toBeDefined()
    const cleared = await updatePostInterventionHedgerow.handler(
      request({ ...edits, advanceYears: null }, stored)
    )
    expect(cleared.proposed.advanceYears).toBeNull()
  }
)

test('omitted timing preserves 30+ metadata and validates positive fractions against a new delay', async () => {
  const payload = { ...edits }
  delete payload.advanceYears
  const stored = {
    ...feature,
    proposed: {
      ...feature.proposed,
      advanceYears: 30,
      advanceYearsIs30Plus: true,
      delayYears: 0
    }
  }
  const result = await updatePostInterventionHedgerow.handler(
    request(payload, stored)
  )
  expect(result.proposed).toMatchObject({
    advanceYears: 30,
    advanceYearsIs30Plus: true
  })
  await expect(
    updatePostInterventionHedgerow.handler(
      request(
        { ...payload, delayYears: 1 },
        { ...stored, proposed: { ...stored.proposed, advanceYears: 0.5 } }
      )
    )
  ).rejects.toMatchObject({ output: { statusCode: 400 } })
})

test.each([true, false])(
  'a renamed legacy Created hedgerow preserves its original parent (%s) through resync',
  (hasParent) => {
    const parentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    const otherId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const original = {
      ...feature,
      baseline: { type: 'Native hedgerow', condition: 'Poor' }
    }
    const baseline = {
      hedgerows: [
        ...(hasParent
          ? [
              {
                featureId: parentId,
                ref: 'H-1',
                type: 'Native hedgerow',
                condition: 'Poor'
              }
            ]
          : []),
        {
          featureId: otherId,
          ref: 'H-2',
          type: 'Native hedgerow with trees',
          condition: 'Good'
        }
      ]
    }
    const result = applyFeatureUpdate(
      { baseline, postIntervention: { hedgerows: [original] } },
      {
        featureId,
        edits: { ...edits, ref: 'H-2' },
        expectedType: 'hedgerow',
        documentKey: 'postIntervention'
      }
    )
    const saved = result.feature
    expect(saved).toMatchObject({
      ref: 'H-2',
      referenceEdited: true,
      parentFeatureId: hasParent ? parentId : null
    })
    const changed = structuredClone(baseline)
    if (hasParent) {
      changed.hedgerows[0].ref = 'Baseline renamed'
      changed.hedgerows[0].condition = 'Moderate'
    }
    resyncPostInterventionBaselineSide(
      { hedgerows: [saved] },
      { baseline: changed, previousBaseline: baseline }
    )
    expect(saved.ref).toBe('H-2')
    expect(saved.baseline).toMatchObject({
      type: 'Native hedgerow',
      condition: hasParent ? 'Moderate' : 'Poor'
    })
    expect(
      postInterventionLinearHabitatSchema.validate(saved).error
    ).toBeUndefined()
  }
)

test.each([null, ''])(
  'reference-only edit preserves rejected significance when blank remains %j',
  async (strategicSignificance) => {
    const stored = {
      ...feature,
      proposed: {
        ...feature.proposed,
        strategicSignificance: null,
        rejectedStrategicSignificance: 'Medium',
        advanceYears: 0,
        delayYears: 0
      }
    }
    const saved = await updatePostInterventionHedgerow.handler(
      request({ ...edits, condition: 'Poor', strategicSignificance }, stored)
    )
    expect(saved).toMatchObject({
      ref: edits.ref,
      status: 'Incomplete',
      units: null,
      proposed: {
        strategicSignificance: null,
        rejectedStrategicSignificance: 'Medium'
      }
    })
    expect(stored.proposed.rejectedStrategicSignificance).toBe('Medium')
    const corrected = await updatePostInterventionHedgerow.handler(
      request({ ...edits, strategicSignificance: 'High' }, saved)
    )
    expect(corrected).toMatchObject({
      status: 'Complete',
      proposed: {
        strategicSignificance: 'High',
        rejectedStrategicSignificance: null
      }
    })
    expect(corrected.units).toBeGreaterThan(0)
    expect(
      postInterventionLinearHabitatSchema.validate(corrected).error
    ).toBeUndefined()
  }
)

test('a missing hedgerow returns a type-specific 404 without persisting', async () => {
  await expect(
    updatePostInterventionHedgerow.handler(
      request(edits, {
        ...feature,
        featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      })
    )
  ).rejects.toMatchObject({
    output: { statusCode: 404 },
    message: `Hedgerow ${featureId} not found in project ${projectId}`
  })
  expect(setProjectFeature).not.toHaveBeenCalled()
})

test.each(['Good', 'Moderate'])(
  'retains an unsupported imported %s condition on a reference-only save',
  async (condition) => {
    const stored = {
      ...feature,
      proposed: {
        ...feature.proposed,
        type: 'Non-native and ornamental hedgerow',
        condition
      }
    }
    const { condition: _condition, ...payload } = {
      ...edits,
      habitatType: stored.proposed.type
    }
    expect(
      postInterventionHedgerowEditPayload.validate(payload).error
    ).toBeUndefined()
    const saved = await updatePostInterventionHedgerow.handler(
      request(payload, stored)
    )
    expect(saved.ref).toBe(edits.ref)
    expect(saved.proposed.condition).toBe(condition)
    expect(
      postInterventionLinearHabitatSchema.validate(saved).error
    ).toBeUndefined()
    expect(() =>
      validateCreatedHedgerowEdit(stored, { ...payload, condition })
    ).toThrow('Choose valid hedgerow')
    expect(() =>
      validateCreatedHedgerowEdit(stored, {
        ...payload,
        habitatType: 'Native hedgerow'
      })
    ).toThrow('Choose a target condition')
    const cleared = await updatePostInterventionHedgerow.handler(
      request({ ...payload, condition: null }, stored)
    )
    expect(cleared.proposed.condition).toBeNull()
  }
)
