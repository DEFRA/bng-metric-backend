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
import { updatePostInterventionAreaHabitat } from './habitats.js'
import { setProjectFeature } from '../db/persist-project.js'

vi.mock('../db/persist-project.js', () => ({
  setProjectFeature: vi.fn().mockResolvedValue(undefined)
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
  ])('null %s saves zero units and Incomplete', (field) => {
    const cleared = { [field]: null }
    if (field === 'broadType') {
      cleared.habitatType = null
      cleared.condition = null
    }
    if (field === 'habitatType') {
      cleared.condition = null
    }
    const result = update(cleared)
    expect(result.feature).toMatchObject({ units: 0, status: 'Incomplete' })
    expect(result.unitsTotals.habitatsTotal).toBe(4)
  })

  test('partial edits retain independent derived values and clear dependent ones', () => {
    const result = update({ condition: null })
    expect(result.feature.proposed).toMatchObject({
      distinctiveness: 'Low',
      difficulty: 'Low',
      difficultyMultiplier: 1,
      standardTimeToTargetCondition: null,
      finalTimeToTargetCondition: null,
      timeMultiplier: null
    })
  })

  test('30+ survives persistence validation and uses engine overflow time multiplier', () => {
    const result = update({ delayYears: '30+' })
    expect(result.feature.proposed).toMatchObject({
      delayYears: '30+',
      timeMultiplier: TIME_TO_TARGET_MULTIPLIER['>30']
    })
    expect(
      postInterventionHabitatSchema.validate(result.feature).error
    ).toBeUndefined()
    expect(
      postInterventionAreaEditPayload.validate({ ...edits, delayYears: '30+' })
        .error
    ).toBeUndefined()
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

  test('route persists the complete edit and records the authenticated actor', async () => {
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
      payload: edits,
      auth: { credentials: { sub: 'test-user' } },
      drizzle: { transaction: (fn) => fn(tx) }
    }
    const result = await updatePostInterventionAreaHabitat.handler(request, {})
    expect(result.status).toBe('Complete')
    expect(setProjectFeature).toHaveBeenCalledWith(
      tx,
      projectId,
      expect.objectContaining({ feature: result, actorId: 'test-user' })
    )
    vi.mocked(setProjectFeature).mockClear()
    request.payload = { ...edits, advanceYears: 1, delayYears: 1 }
    await expect(
      updatePostInterventionAreaHabitat.handler(request, {})
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
    expect(setProjectFeature).not.toHaveBeenCalled()
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
      }
    }
  }
})
