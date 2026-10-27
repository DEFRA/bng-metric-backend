import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichBaselineDocumentWithUnits } from '../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import {
  makeAreaHabitat,
  makeHedgerow,
  makeWatercourse,
  makeEnhancedHabitat,
  makeEnhancedHedgerow,
  makeEnhancedWatercourse
} from '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.fixtures.js'
import { rederivePostInterventionFromBaseline } from '../../utilities/enrichment/post-intervention/resync-post-intervention-baseline.js'

const calculators = vi.hoisted(() => ({}))
vi.mock('bng-library/metric', async (importOriginal) => {
  const actual = await importOriginal()
  const wrapped = { ...actual }
  for (const [name, calculate] of Object.entries(actual)) {
    if (name.startsWith('calculate') && typeof calculate === 'function') {
      calculators[name] = vi.fn(calculate)
      wrapped[name] = calculators[name]
    }
  }
  return wrapped
})

beforeEach(() => vi.clearAllMocks())
const LAYERS = [
  ['habitats', makeAreaHabitat, 'AreaHabitat'],
  ['trees', makeAreaHabitat, 'AreaHabitat'],
  ['hedgerows', makeHedgerow, 'Hedgerow'],
  ['watercourses', makeWatercourse, 'Watercourse']
]
const BASELINE_LENGTHS = new Map([
  ['HW1', 1],
  ['R1', 1]
])
const OPTIONS = { baselineLengthByRef: BASELINE_LENGTHS }
const MISSING = [null, undefined, '', '   ']

function makeProposedFeature(layer, factory, category) {
  const enhanced = {
    habitats: makeEnhancedHabitat,
    trees: makeEnhancedHabitat,
    hedgerows: makeEnhancedHedgerow,
    watercourses: makeEnhancedWatercourse
  }
  const feature = category === 'Enhanced' ? enhanced[layer]() : factory()
  feature.retentionCategory = category
  return feature
}

function assertNoProposedCalculation() {
  for (const [name, calculate] of Object.entries(calculators)) {
    if (name.endsWith('PostIntervention')) {
      expect(calculate, name).not.toHaveBeenCalled()
    }
  }
}

function identityFields(layer) {
  return layer === 'watercourses'
    ? ['type', 'condition', 'watercourseEncroachment', 'riparianEncroachment']
    : ['type', 'condition']
}

const baselineCases = LAYERS.flatMap(([layer, factory, engine]) =>
  identityFields(layer).flatMap((field) =>
    MISSING.map((value) => [layer, factory, engine, field, value])
  )
)

describe('BMD-1070 baseline required inputs', () => {
  it.each(baselineCases)(
    'case %# saves null units without calling the baseline calculator',
    (layer, factory, engine, field, value) => {
      const original = factory()
      const feature = {
        ...original,
        ...original.baseline,
        [field]: value,
        units: 99,
        status: 'Complete'
      }
      const document = { [layer]: [feature] }
      enrichBaselineDocumentWithUnits(document)
      expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
      expect(calculators[`calculate${engine}Baseline`]).not.toHaveBeenCalled()
      expect(document.units.totalUnits).toBe(0)
      // Fixing the input must allow the same stored row to be priced again.
      feature[field] = original.baseline[field]
      enrichBaselineDocumentWithUnits(document)
      expect(feature.status).toBe('Complete')
      expect(feature.units).toBeGreaterThan(0)
      expect(calculators[`calculate${engine}Baseline`]).toHaveBeenCalled()
    }
  )

  it.each(LAYERS)(
    '%s ignores null metadata that the calculation does not use',
    (layer, factory) => {
      const original = factory()
      const feature = {
        ...original,
        ...original.baseline,
        strategicSignificance: null,
        habitatCreatedInAdvanceYears: null,
        delayInStartingHabitatCreationYears: null
      }
      enrichBaselineDocumentWithUnits({ [layer]: [feature] })
      expect(feature.status).toBe('Complete')
      expect(feature.units).toBeGreaterThan(0)
    }
  )
})

const proposedCases = LAYERS.flatMap(([layer, factory]) =>
  ['Created', 'Enhanced', 'Retained'].flatMap((category) => {
    const fields = identityFields(layer).map((field) => ['proposed', field])
    if (category !== 'Created') {
      const baselineFields =
        category === 'Retained' ? identityFields(layer) : ['type', 'condition']
      fields.push(...baselineFields.map((field) => ['baseline', field]))
    }
    if (category !== 'Retained') {
      fields.push(
        ...['advanceYears', 'delayYears', 'strategicSignificance'].map(
          (field) => ['proposed', field]
        )
      )
    }
    return fields.map(([side, field]) => [
      layer,
      factory,
      category,
      side,
      field
    ])
  })
)

describe('BMD-1070 post-intervention required inputs', () => {
  it.each(proposedCases)(
    'case %# missing required input prevents proposed pricing and clears stale units',
    (layer, factory, category, side, field) => {
      const feature = makeProposedFeature(layer, factory, category)
      enrichPostInterventionDocumentWithUnits(
        { [layer]: [feature] },
        undefined,
        OPTIONS
      )
      expect(feature.status).toBe('Complete')
      vi.clearAllMocks()
      feature.units = 99
      feature.status = 'Complete'
      const originalValue = feature[side][field]
      feature[side][field] = null
      const document = { [layer]: [feature] }
      enrichPostInterventionDocumentWithUnits(document, undefined, OPTIONS)
      expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
      assertNoProposedCalculation()
      expect(document.units.totalUnits).toBe(0)
      feature[side][field] = originalValue
      enrichPostInterventionDocumentWithUnits(document, undefined, OPTIONS)
      expect(feature.status).toBe('Complete')
      expect(feature.units).toBeGreaterThan(0)
    }
  )

  it.each(LAYERS)(
    '%s Retained does not require timing or strategic significance',
    (layer, factory) => {
      const feature = factory()
      Object.assign(feature.proposed, {
        advanceYears: null,
        delayYears: null,
        strategicSignificance: null
      })
      enrichPostInterventionDocumentWithUnits(
        { [layer]: [feature] },
        undefined,
        OPTIONS
      )
      expect(feature.status).toBe('Complete')
      expect(feature.units).toBeGreaterThan(0)
    }
  )

  it.each(
    LAYERS.flatMap(([layer, factory]) =>
      ['Created', 'Enhanced'].map((category) => [layer, factory, category])
    )
  )(
    'case %# explicit zero timing calculates units',
    (layer, factory, category) => {
      const feature = makeProposedFeature(layer, factory, category)
      Object.assign(feature.proposed, { advanceYears: 0, delayYears: 0 })
      enrichPostInterventionDocumentWithUnits(
        { [layer]: [feature] },
        undefined,
        OPTIONS
      )
      expect(feature.status).toBe('Complete')
      expect(feature.units).toBeGreaterThan(0)
    }
  )

  it.each(LAYERS)(
    '%s baseline edit clears old Retained units and recalculates totals',
    (layer, factory) => {
      const feature = factory()
      feature.units = 99
      feature.status = 'Complete'
      const before = {
        ...feature.baseline,
        featureId: 'source',
        ref: feature.ref,
        sizeMetres: 1000
      }
      const after = { ...before, condition: null }
      const result = rederivePostInterventionFromBaseline(
        { [layer]: [feature] },
        {
          previousBaseline: { [layer]: [before] },
          baseline: { [layer]: [after] }
        }
      )
      expect(result[layer][0]).toMatchObject({
        units: null,
        status: 'Incomplete'
      })
      expect(result.units.totalUnits).toBe(0)
      expect(feature.units).toBe(99)
      assertNoProposedCalculation()
    }
  )
})

describe('BMD-1070 mixed documents and missing sizes', () => {
  it.each(LAYERS)(
    '%s only excludes the incomplete feature from totals',
    (layer, factory) => {
      const incomplete = factory()
      incomplete.proposed.condition = null
      incomplete.units = 99
      const complete = factory()
      complete.ref = 'CONTROL'
      const document = { [layer]: [incomplete, complete] }
      enrichPostInterventionDocumentWithUnits(document, undefined, OPTIONS)
      expect(incomplete).toMatchObject({ units: null, status: 'Incomplete' })
      expect(complete.status).toBe('Complete')
      expect(document.units.totalUnits).toBeCloseTo(complete.units)
    }
  )

  it.each(LAYERS)(
    '%s null size prevents baseline and proposed calculations',
    (layer, factory) => {
      const feature = factory()
      Object.assign(feature, {
        sizeSquareMetres: null,
        area: null,
        sizeMetres: null,
        units: 99,
        status: 'Complete'
      })
      enrichPostInterventionDocumentWithUnits(
        { [layer]: [feature] },
        undefined,
        OPTIONS
      )
      expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
      assertNoProposedCalculation()
      const baseline = {
        ...feature,
        ...feature.baseline,
        units: 99,
        status: 'Complete'
      }
      enrichBaselineDocumentWithUnits({ [layer]: [baseline] })
      expect(baseline).toMatchObject({ units: null, status: 'Incomplete' })
      for (const name of [
        'calculateAreaHabitatBaseline',
        'calculateHedgerowBaseline',
        'calculateWatercourseBaseline'
      ]) {
        expect(calculators[name]).not.toHaveBeenCalled()
      }
    }
  )

  it('Enhanced watercourse pricing does not require unused baseline encroachments', () => {
    const feature = makeEnhancedWatercourse()
    Object.assign(feature.baseline, {
      watercourseEncroachment: null,
      riparianEncroachment: null
    })
    enrichPostInterventionDocumentWithUnits(
      { watercourses: [feature] },
      undefined,
      OPTIONS
    )
    expect(feature.status).toBe('Complete')
    expect(feature.units).toBeGreaterThan(0)
    expect(
      calculators.calculateEnhancedWatercoursePostIntervention
    ).toHaveBeenCalled()
  })

  it.each(LAYERS)(
    '%s failed lookup clears previously calculated units',
    (layer, factory) => {
      const feature = factory()
      feature.proposed.condition = 'not a condition'
      feature.retentionCategory = 'Created'
      feature.units = 99
      enrichPostInterventionDocumentWithUnits(
        { [layer]: [feature] },
        undefined,
        OPTIONS
      )
      expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
    }
  )
})

describe('BMD-1060 AC5 Lost area replacements follow Created timing rules', () => {
  it.each(['Lost', '4. Lost'])(
    '%s uses its populated timing when calculating replacement units',
    (retention) => {
      const feature = makeAreaHabitat({
        retentionCategory: 'Created',
        properties: { Retention_Category: retention }
      })
      Object.assign(feature.proposed, { advanceYears: 2, delayYears: 0 })
      enrichPostInterventionDocumentWithUnits({ habitats: [feature] })
      expect(feature.status).toBe('Complete')
      expect(feature.units).toBeGreaterThan(0)
      expect(feature.proposed.advanceYears).toBe(2)
      expect(feature.proposed.delayYears).toBe(0)
      expect(
        calculators.calculateCreatedAreaHabitatPostIntervention
      ).toHaveBeenLastCalledWith(
        1,
        expect.any(String),
        'Good',
        2,
        0,
        expect.any(String)
      )
    }
  )
})

it('legacy Lost area replacements with null timing stay incomplete after resync', () => {
  const feature = makeAreaHabitat({ retentionCategory: undefined })
  feature.baseline.retentionCategory = 'Lost'
  Object.assign(feature, { units: 42, status: 'Complete' })
  Object.assign(feature.proposed, {
    advanceYears: null,
    delayYears: null,
    timeMultiplier: 0.8,
    finalTimeToTargetCondition: '7 years (0.8)'
  })
  const result = rederivePostInterventionFromBaseline(
    { habitats: [feature] },
    { baseline: {} }
  )
  expect(result.habitats[0]).toMatchObject({
    status: 'Incomplete',
    units: null
  })
  expect(result.habitats[0].proposed).toMatchObject({
    advanceYears: null,
    delayYears: null,
    timeMultiplier: null,
    finalTimeToTargetCondition: null
  })
  expect(
    calculators.calculateCreatedAreaHabitatPostIntervention
  ).not.toHaveBeenCalled()
})

it.each(LAYERS)(
  'a rejected %s calculation clears every stale pricing field',
  (layer, factory) => {
    const feature = makeProposedFeature(layer, factory, 'Created')
    const fields = [
      'distinctiveness',
      'distinctivenessScore',
      'conditionScore',
      'timeMultiplier',
      'difficultyMultiplier',
      'difficulty',
      'standardTimeToTargetCondition',
      'finalTimeToTargetCondition'
    ]
    for (const field of fields) {
      feature.proposed[field] = 'stale pricing result'
    }
    feature.units = 99
    feature.status = 'Complete'
    feature.proposed.condition = null
    feature.proposed.advanceOrDelay = 'Original input summary'
    enrichPostInterventionDocumentWithUnits(
      { [layer]: [feature] },
      undefined,
      OPTIONS
    )
    expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
    for (const field of fields) {
      expect(feature.proposed[field], field).toBeNull()
    }
    expect(feature.proposed.advanceOrDelay).toBe('Original input summary')
    assertNoProposedCalculation()
  }
)
