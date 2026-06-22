import { describe, test, expect } from 'vitest'

import { APPLY_RESULT, applyFeatureUpdate } from './apply-feature-update.js'

const HABITAT_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
const HEDGEROW_ID = 'bb0e8400-e29b-41d4-a716-446655440002'
const WATERCOURSE_ID = 'cc0e8400-e29b-41d4-a716-446655440003'

function projectFixture() {
  return {
    name: 'Fixture',
    baseline: {
      habitats: [
        {
          featureId: HABITAT_ID,
          ref: 'A1',
          type: 'Modified grassland',
          broadType: 'Grassland',
          condition: 'Poor',
          sizeSquareMetres: 10_000,
          units: 4
        }
      ],
      hedgerows: [
        {
          featureId: HEDGEROW_ID,
          ref: 'H1',
          type: null,
          condition: null,
          sizeMetres: 1000
        }
      ],
      watercourses: [],
      units: {
        totalUnits: 4,
        habitatsTotal: 4,
        hedgerowsTotal: 0,
        watercoursesTotal: 0
      }
    }
  }
}

describe('applyFeatureUpdate — habitat dispatch', () => {
  test('recomputes derived fields and writes them under canonical keys', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.type).toBe('habitat')
    expect(result.feature).toMatchObject({
      featureId: HABITAT_ID,
      broadType: 'Grassland',
      type: 'Lowland meadows',
      condition: 'Good',
      distinctiveness: 'V.High',
      distinctivenessScore: 8,
      conditionScore: 3,
      units: 24,
      status: 'Complete'
    })
    // The canonical key is `units` — guard against the BMD-480 regression
    // where the area route wrote `habitatUnits` instead.
    expect(result.feature.habitatUnits).toBeUndefined()
    // Surgical-write locators used by persist-project.js.
    expect(result.layer).toBe('habitats')
    expect(result.index).toBe(0)
    expect(result.unitsTotals).toEqual(result.project.baseline.units)
  })

  test('refreshes baseline.units totals so the habitat-list summary stays in sync', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(result.project.baseline.units).toEqual({
      totalUnits: 24,
      habitatsTotal: 24,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
  })

  test('preserves non-edited fields on the feature', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(result.feature.ref).toBe('A1')
    expect(result.feature.sizeSquareMetres).toBe(10_000)
  })

  test('does not mutate the input project', () => {
    const project = projectFixture()
    const before = JSON.stringify(project)
    applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(JSON.stringify(project)).toBe(before)
  })

  test('treats whitespace-only edit strings as null', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: '   ',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature.broadType).toBeNull()
  })

  test('passes through a non-string, non-null edit value unchanged', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 42,
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature.broadType).toBe(42)
  })

  test('handles a habitat feature with no sizeSquareMetres property', () => {
    const project = projectFixture()
    delete project.baseline.habitats[0].sizeSquareMetres

    const result = applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature.units).toBeDefined()
  })

  test('handles a hedgerow feature with no sizeMetres property', () => {
    const project = projectFixture()
    delete project.baseline.hedgerows[0].sizeMetres

    const result = applyFeatureUpdate(project, {
      featureId: HEDGEROW_ID,
      edits: { habitatType: 'Native hedgerow', condition: 'Good' }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature.units).toBeDefined()
  })
})

describe('applyFeatureUpdate — hedgerow dispatch', () => {
  test('persists hedgerow shape under canonical keys', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HEDGEROW_ID,
      edits: {
        habitatType: 'Native hedgerow',
        condition: 'Good'
      }
    })
    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.type).toBe('hedgerow')
    expect(result.layer).toBe('hedgerows')
    // 1 km × Low (2) × Good (3) × 1 SS = 6 units. Pins the wiring from the
    // helper through `recomputeHedgerow` to the engine.
    expect(result.feature).toMatchObject({
      featureId: HEDGEROW_ID,
      type: 'Native hedgerow',
      condition: 'Good',
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      conditionScore: 3,
      units: 6,
      status: 'Complete'
    })
    expect(result.feature.broadType).toBeUndefined()
  })

  test('updates the hedgerows layer, not habitats', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HEDGEROW_ID,
      edits: { habitatType: 'Native hedgerow', condition: 'Good' }
    })
    expect(result.project.baseline.hedgerows[0].type).toBe('Native hedgerow')
    expect(result.project.baseline.habitats[0].type).toBe('Modified grassland')
  })
})

describe('applyFeatureUpdate — error outcomes', () => {
  test('returns FEATURE_NOT_FOUND when the featureId is absent', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: '99999999-9999-9999-9999-999999999999',
      edits: { habitatType: null, condition: null }
    })
    expect(result.status).toBe(APPLY_RESULT.FEATURE_NOT_FOUND)
  })

  test('returns FEATURE_NOT_FOUND when the project has no baseline', () => {
    const result = applyFeatureUpdate(
      { name: 'Bare' },
      { featureId: HABITAT_ID, edits: {} }
    )
    expect(result.status).toBe(APPLY_RESULT.FEATURE_NOT_FOUND)
  })

  test('returns FEATURE_WRONG_TYPE when expectedType differs from the data', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HEDGEROW_ID,
      edits: { habitatType: 'X', condition: 'Y' },
      expectedType: 'habitat'
    })
    expect(result.status).toBe(APPLY_RESULT.FEATURE_WRONG_TYPE)
    expect(result.type).toBe('hedgerow')
  })

  test('accepts the matching expectedType', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      },
      expectedType: 'habitat'
    })
    expect(result.status).toBe(APPLY_RESULT.OK)
  })

  test('returns UNSUPPORTED_TYPE for a watercourse featureId', () => {
    const project = projectFixture()
    project.baseline.watercourses = [
      {
        featureId: WATERCOURSE_ID,
        ref: 'W1',
        type: 'River',
        sizeMetres: 200
      }
    ]
    const result = applyFeatureUpdate(project, {
      featureId: WATERCOURSE_ID,
      edits: { habitatType: 'River', condition: 'Good' }
    })
    expect(result.status).toBe(APPLY_RESULT.UNSUPPORTED_TYPE)
    expect(result.type).toBe('watercourse')
  })
})

function postInterventionProjectFixture() {
  return {
    name: 'PI Fixture',
    postIntervention: {
      habitats: [
        {
          featureId: HABITAT_ID,
          ref: 'H1-1',
          area: 10_000,
          sizeSquareMetres: 10_000,
          units: null,
          status: 'Incomplete',
          baseline: {
            type: 'Modified grassland',
            broadType: 'Grassland',
            condition: 'Moderate',
            conditionScore: null,
            distinctiveness: null,
            distinctivenessScore: null
          },
          proposed: {
            type: 'Modified grassland',
            broadType: 'Grassland',
            condition: 'Poor',
            conditionScore: null,
            distinctiveness: null,
            distinctivenessScore: null,
            advanceYears: 0,
            delayYears: 0
          }
        }
      ],
      hedgerows: [
        {
          featureId: HEDGEROW_ID,
          ref: 'HW1',
          sizeMetres: 500,
          units: null,
          status: 'Incomplete',
          baseline: {
            type: 'Species-rich native hedgerow',
            condition: 'Moderate',
            conditionScore: null,
            distinctiveness: null,
            distinctivenessScore: null
          },
          proposed: {
            type: null,
            condition: null,
            conditionScore: null,
            distinctiveness: null,
            distinctivenessScore: null,
            advanceYears: 0,
            delayYears: 0
          }
        }
      ],
      watercourses: [],
      units: {
        totalUnits: 0,
        habitatsTotal: 0,
        hedgerowsTotal: 0,
        watercoursesTotal: 0
      }
    }
  }
}

describe('applyFeatureUpdate — postIntervention documentKey', () => {
  test('writes edits into the proposed sub-object, not top-level fields', () => {
    const result = applyFeatureUpdate(postInterventionProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      },
      documentKey: 'postIntervention'
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    const feature = result.feature
    // proposed side should be updated
    expect(feature.proposed.type).toBe('Lowland meadows')
    expect(feature.proposed.broadType).toBe('Grassland')
    expect(feature.proposed.condition).toBe('Good')
    expect(typeof feature.proposed.distinctiveness).toBe('string')
    expect(typeof feature.proposed.conditionScore).toBe('number')
    // top-level units and status should be updated
    expect(typeof feature.units).toBe('number')
    expect(feature.status).toBe('Complete')
    // top-level type/condition should NOT be set
    expect(feature).not.toHaveProperty('type')
    expect(feature).not.toHaveProperty('condition')
    expect(feature).not.toHaveProperty('distinctiveness')
  })

  test('preserves baseline sub-object unchanged', () => {
    const result = applyFeatureUpdate(postInterventionProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      },
      documentKey: 'postIntervention'
    })

    expect(result.feature.baseline).toEqual(
      expect.objectContaining({
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Moderate'
      })
    )
  })

  test('refreshes postIntervention.units totals', () => {
    const result = applyFeatureUpdate(postInterventionProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      },
      documentKey: 'postIntervention'
    })

    expect(result.project.postIntervention.units.habitatsTotal).toBeGreaterThan(
      0
    )
    expect(result.unitsTotals).toEqual(result.project.postIntervention.units)
  })

  test('writes hedgerow type into proposed.type, not a top-level field', () => {
    const result = applyFeatureUpdate(postInterventionProjectFixture(), {
      featureId: HEDGEROW_ID,
      edits: {
        habitatType: 'Native hedgerow',
        condition: 'Good'
      },
      documentKey: 'postIntervention'
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.type).toBe('hedgerow')
    expect(result.feature.proposed.type).toBe('Native hedgerow')
    expect(result.feature.proposed.condition).toBe('Good')
    expect(result.feature).not.toHaveProperty('type')
    expect(result.feature).not.toHaveProperty('condition')
  })
})
