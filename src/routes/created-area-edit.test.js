import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  calculateCreatedAreaHabitatPostIntervention,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_MULTIPLIER,
  roundToSigFigs
} from 'bng-library/metric'
import { getAreaCreationReference } from '../validation/reference/area-creation.js'
import { postInterventionHabitatSchema } from '../validation/post-intervention/project-post-intervention-schema.js'
import { applyFeatureUpdate } from '../utilities/features/apply-feature-update.js'
import {
  validateCreatedAreaEdit,
  postInterventionAreaEditPayload
} from './created-area-edit.js'
import {
  resyncPostInterventionBaselineSide,
  rederivePostInterventionFromBaseline
} from '../utilities/enrichment/post-intervention/resync-post-intervention-baseline.js'
import { normaliseProposedCombinations } from '../validation/geopackage/post-intervention/normalise-proposed-combinations.js'
import { updatePostInterventionAreaHabitat } from './habitats.js'
import { setProjectFeature } from '../db/persist-project.js'
import { setGeometryRefs } from '../db/feature-geometry-refs.js'
import { featureEditPayload } from './shared-params.js'

vi.mock('../db/persist-project.js', () => ({
  setProjectFeature: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../db/feature-geometry-refs.js', () => ({
  setGeometryRefs: vi.fn().mockResolvedValue(undefined)
}))

const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const projectId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const feature = {
  featureId,
  ref: 'P-1',
  retentionCategory: 'Created',
  sizeSquareMetres: 25000,
  units: 2,
  status: 'Complete',
  baseline: {},
  proposed: {
    broadType: 'Grassland',
    type: 'Modified grassland',
    condition: 'Poor'
  }
}
const edits = {
  ref: 'New reference',
  broadType: 'Grassland',
  habitatType: 'Modified grassland',
  condition: 'Good',
  strategicSignificance: 'High',
  advanceYears: 0,
  delayYears: 0
}

function update(overrides = {}) {
  return applyFeatureUpdate(
    {
      postIntervention: {
        habitats: [
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
      expectedType: 'habitat'
    }
  )
}

function routeRequest(payload) {
  const row = { project: { postIntervention: { habitats: [feature] } } }
  const tx = {
    execute: vi.fn(),
    select: () => ({
      from: () => ({
        where: () => ({ for: () => ({ limit: async () => [row] }) })
      })
    })
  }
  const request = {
    params: { projectId, featureId },
    payload,
    auth: { credentials: { sub: 'test-user' } },
    drizzle: { transaction: (fn) => fn(tx) }
  }
  return { request, tx }
}

describe('BMD-1048 Created area edits', () => {
  beforeEach(() => vi.clearAllMocks())

  test('reference options are area-only and exclude creation conditions marked Not Possible', () => {
    const reference = getAreaCreationReference()
    expect(reference.habitatTypes.length).toBeGreaterThan(0)
    expect(
      reference.habitatTypes.some(
        (t) => t.broad === 'Individual trees' || t.name.includes('(IGGI)')
      )
    ).toBe(false)
    for (const type of reference.habitatTypes) {
      expect(type.conditions.length).toBeGreaterThan(0)
      for (const condition of type.conditions) {
        expect(
          TIME_TO_TARGET_CREATION[`${type.broad} - ${type.name}`]?.[
            condition.condition
          ] ?? TIME_TO_TARGET_CREATION[type.name]?.[condition.condition]
        ).toBe(condition.years)
        expect(condition.years).not.toBe('Not Possible')
      }
    }
  })

  test('persists editable and derived fields, recalculates units and area totals', () => {
    const result = update()
    const units = roundToSigFigs(
      2.5 * 2 * 3 * 1.15 * TIME_TO_TARGET_MULTIPLIER['7']
    )
    expect(result.feature).toMatchObject({
      ref: 'New reference',
      units,
      status: 'Complete',
      sizeSquareMetres: 25000,
      retentionCategory: 'Created',
      proposed: {
        type: 'Modified grassland',
        condition: 'Good',
        distinctiveness: 'Low',
        distinctivenessScore: 2,
        conditionScore: 3,
        difficulty: 'Low',
        difficultyMultiplier: 1,
        standardTimeToTargetCondition: '7',
        strategicSignificanceCategory: 'High',
        strategicSignificanceScore: 1.15,
        advanceYears: 0,
        delayYears: 0,
        timeMultiplier: TIME_TO_TARGET_MULTIPLIER['7']
      }
    })
    expect(result.unitsTotals.habitatsTotal).toBeCloseTo(units + 4)
    expect(feature.ref).toBe('P-1')
  })

  test.each([
    'broadType',
    'habitatType',
    'condition',
    'strategicSignificance',
    'advanceYears',
    'delayYears'
  ])('null %s saves null units and Incomplete', (field) => {
    const cleared = { [field]: null }
    if (field === 'broadType') {
      cleared.habitatType = null
      cleared.condition = null
    }
    if (field === 'habitatType') {
      cleared.condition = null
    }
    const result = update(cleared)
    expect(result.feature).toMatchObject({ units: null, status: 'Incomplete' })
    expect(result.unitsTotals.habitatsTotal).toBe(4)
  })

  test.each([
    'condition',
    'strategicSignificance',
    'advanceYears',
    'delayYears'
  ])(
    'incomplete %s pricing stays identical after a baseline resync',
    (field) => {
      const edited = update({ [field]: null }).feature
      const rederived = rederivePostInterventionFromBaseline(
        { habitats: [edited] },
        { baseline: {} }
      ).habitats[0]
      for (const row of [edited, rederived]) {
        expect(row).toMatchObject({ units: null, status: 'Incomplete' })
        expect(row.proposed).toMatchObject({
          distinctiveness: null,
          distinctivenessScore: null,
          difficulty: null,
          difficultyMultiplier: null,
          conditionScore: null,
          standardTimeToTargetCondition: null,
          finalTimeToTargetCondition: null,
          timeMultiplier: null
        })
        expect(
          row.proposed[field === 'condition' ? 'condition' : field]
        ).toBeNull()
      }
    }
  )

  test('30+ survives persistence validation and uses engine overflow time multiplier', () => {
    const result = update({ delayYears: '30+' })
    expect(result.feature.proposed).toMatchObject({
      delayYears: 30,
      delayYearsIs30Plus: true,
      timeMultiplier: TIME_TO_TARGET_MULTIPLIER['>30']
    })
    expect(
      postInterventionHabitatSchema.validate(result.feature).error
    ).toBeUndefined()
    expect(
      postInterventionHabitatSchema.validate({
        ...result.feature,
        proposed: { ...result.feature.proposed, delayYears: '30+' }
      }).error
    ).toBeDefined()
    expect(
      postInterventionAreaEditPayload.validate({ ...edits, delayYears: '30+' })
        .error
    ).toBeUndefined()
  })

  test.each([
    [0, 0, 'Neither'],
    [2, 0, 'Advance - 2 years'],
    [0, 3, 'Delay - 3 years'],
    ['30+', 0, 'Advance - 30 years'],
    [0, '30+', 'Delay - 30 years']
  ])(
    'saves a timing summary for %s/%s',
    (advanceYears, delayYears, summary) => {
      expect(
        update({ advanceYears, delayYears }).feature.proposed.advanceOrDelay
      ).toBe(summary)
    }
  )

  test.each(['advanceYears', 'delayYears'])(
    'recomputes a legacy edit after saving 30+ %s',
    (field) => {
      const saved = update({ [field]: '30+' }).feature
      const result = applyFeatureUpdate(
        { postIntervention: { habitats: [saved] } },
        {
          featureId,
          edits: {
            broadType: 'Grassland',
            habitatType: 'Modified grassland',
            condition: 'Moderate'
          },
          documentKey: 'postIntervention',
          expectedType: 'habitat'
        }
      )
      const expected = calculateCreatedAreaHabitatPostIntervention(
        2.5,
        'Grassland - Modified grassland',
        'Moderate',
        saved.proposed.advanceYears,
        saved.proposed.delayYears,
        'High'
      )
      expect(result.feature.status).toBe('Complete')
      expect(result.feature.units).toBe(expected.units)
      expect(result.feature.proposed[field]).toBe(30)
      expect(result.feature.proposed[`${field}Is30Plus`]).toBe(true)
      expect(result.feature.proposed.finalTimeToTargetCondition).toContain(
        `(${expected.timeMultiplier})`
      )
    }
  )

  test.each(['Created', 'Enhanced'])(
    'clears a 30+ timing conflict on %s',
    (retentionCategory) => {
      const document = {
        habitats: [
          {
            retentionCategory,
            proposed: {
              ...feature.proposed,
              advanceYears: '30+',
              delayYears: 2
            }
          }
        ]
      }
      normaliseProposedCombinations(document)
      expect(document.habitats[0].proposed).toMatchObject({
        advanceYears: null,
        delayYears: null
      })
    }
  )

  test('every offered strategic significance is accepted by the edit schema', () => {
    for (const { value } of getAreaCreationReference().strategicSignificance) {
      expect(
        postInterventionAreaEditPayload.validate({
          ...edits,
          strategicSignificance: value
        }).error
      ).toBeUndefined()
    }
    expect(
      postInterventionAreaEditPayload.validate({
        ...edits,
        strategicSignificance: 'Unknown'
      }).error
    ).toBeDefined()
  })

  test('advance can floor time at zero without resetting delay or difficulty', () => {
    const result = update({ advanceYears: 10 })
    expect(result.feature.proposed).toMatchObject({
      advanceYears: 10,
      delayYears: 0,
      finalTimeToTargetCondition: '0 years (1)',
      difficultyMultiplier: 1
    })
  })

  test.each([
    { ref: '  ' },
    { ref: '\uD800' },
    { advanceYears: 2, delayYears: 3 },
    { broadType: 'Urban' },
    { condition: 'Not Possible' }
  ])('rejects invalid edits before persistence: %j', (invalid) => {
    expect(() =>
      validateCreatedAreaEdit(feature, { ...edits, ...invalid })
    ).toThrow()
  })

  test.each(['', ' ', '\uD800', '\uFFFD'])(
    'uses the shared reference rule for invalid input %j',
    (ref) => {
      const expected = featureEditPayload.validate({ ref }).error
      const actual = postInterventionAreaEditPayload.validate({
        ...edits,
        ref
      }).error
      expect(actual?.message).toBe(expected?.message)
      expect(actual).toBeDefined()
    }
  )

  test('allows duplicate references and valid UTF-8', () => {
    expect(() =>
      validateCreatedAreaEdit(feature, { ...edits, ref: 'P-1' })
    ).not.toThrow()
    expect(() =>
      validateCreatedAreaEdit(feature, { ...edits, ref: 'é 🌿' })
    ).not.toThrow()
  })

  test('keeps legacy payloads valid and rejects invalid timing options', () => {
    expect(
      postInterventionAreaEditPayload.validate({
        broadType: 'Grassland',
        habitatType: 'Modified grassland',
        condition: 'Good'
      }).error
    ).toBeUndefined()
    expect(
      postInterventionAreaEditPayload.validate({ ...edits, advanceYears: -1 })
        .error
    ).toBeDefined()
    expect(
      postInterventionAreaEditPayload.validate({ ...edits, delayYears: 31 })
        .error
    ).toBeDefined()
  })

  test.each([
    { broadType: 'Urban' },
    { habitatType: 'Lowland meadows' },
    { habitatType: 'Urban tree' },
    { habitatType: 'Modified grassland (IGGI)' },
    { habitatType: 'Unknown habitat' },
    { condition: 'Not Possible' }
  ])(
    'the route refuses invalid creation choices without writing: %j',
    async (invalid) => {
      const { request } = routeRequest({ ...edits, ...invalid })
      await expect(
        updatePostInterventionAreaHabitat.handler(request, {})
      ).rejects.toMatchObject({ output: { statusCode: 400 } })
      expect(setProjectFeature).not.toHaveBeenCalled()
      expect(setGeometryRefs).not.toHaveBeenCalled()
    }
  )

  test('route persists the complete edit and records the authenticated actor', async () => {
    const { request, tx } = routeRequest(edits)
    const result = await updatePostInterventionAreaHabitat.handler(request, {})
    expect(result.status).toBe('Complete')
    expect(setProjectFeature).toHaveBeenCalledWith(
      tx,
      projectId,
      expect.objectContaining({ feature: result, actorId: 'test-user' })
    )
    expect(setGeometryRefs).toHaveBeenCalledWith(tx, projectId, [
      {
        documentKey: 'postIntervention',
        layer: 'habitats',
        featureId,
        ref: edits.ref
      }
    ])
    vi.mocked(setProjectFeature).mockClear()
    vi.mocked(setGeometryRefs).mockClear()
    request.payload = { ...edits, advanceYears: 1, delayYears: 1 }
    await expect(
      updatePostInterventionAreaHabitat.handler(request, {})
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
    expect(setProjectFeature).not.toHaveBeenCalled()
    expect(setGeometryRefs).not.toHaveBeenCalled()
  })
})

test('every offered creation combination saves the same units as the metric calculator', () => {
  for (const type of getAreaCreationReference().habitatTypes) {
    for (const condition of type.conditions) {
      for (const advanceYears of [0, 5, '30+']) {
        const values = {
          broadType: type.broad,
          habitatType: type.name,
          condition: condition.condition,
          advanceYears
        }
        const result = update(values)
        const expected = calculateCreatedAreaHabitatPostIntervention(
          2.5,
          `${type.broad} - ${type.name}`,
          condition.condition,
          advanceYears,
          0,
          'High'
        )
        expect(result.feature.units).toBe(expected.units)
        expect(result.feature.proposed.difficultyMultiplier).toBe(
          expected.difficultyMultiplier
        )
        expect(result.feature.proposed.timeMultiplier).toBe(
          expected.timeMultiplier
        )
        expect(result.feature.proposed.finalTimeToTargetCondition).toContain(
          `(${expected.timeMultiplier})`
        )
      }
    }
  }
})

test.each([true, false, 'template'])(
  'a renamed Created area keeps its original parent association (%s)',
  (hasParent) => {
    const originalParentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const otherParentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const original = {
      ...feature,
      ...(hasParent === 'template'
        ? { parentFeatureId: originalParentId }
        : {}),
      baseline: hasParent
        ? {
            type: 'Modified grassland',
            broadType: 'Grassland',
            condition: 'Poor'
          }
        : {}
    }
    const baseline = {
      habitats: [
        ...(hasParent
          ? [
              {
                featureId: originalParentId,
                ref: 'P-1',
                type: 'Modified grassland',
                broadType: 'Grassland',
                condition: 'Poor'
              }
            ]
          : []),
        {
          featureId: otherParentId,
          ref: 'Other parcel',
          type: 'Developed land; sealed surface',
          broadType: 'Urban',
          condition: 'N/A - Other'
        }
      ]
    }
    const result = applyFeatureUpdate(
      { baseline, postIntervention: { habitats: [original] } },
      {
        featureId,
        edits: { ...edits, ref: 'Other parcel' },
        documentKey: 'postIntervention',
        expectedType: 'habitat'
      }
    )
    const saved = result.feature
    expect(saved.parentFeatureId).toBe(hasParent ? originalParentId : null)
    expect(saved.referenceEdited).toBe(true)
    const changedBaseline = structuredClone(baseline)
    if (hasParent) {
      changedBaseline.habitats[0].ref = 'Baseline renamed'
      changedBaseline.habitats[0].condition = 'Good'
    }
    resyncPostInterventionBaselineSide(
      { habitats: [saved] },
      { baseline: changedBaseline, previousBaseline: baseline }
    )
    expect(saved.ref).toBe('Other parcel')
    expect(saved.baseline.broadType).not.toBe('Urban')
    if (hasParent) {
      expect(saved.baseline.condition).toBe('Good')
    } else {
      expect(saved.baseline).toEqual({})
    }
    expect(postInterventionHabitatSchema.validate(saved).error).toBeUndefined()
  }
)
