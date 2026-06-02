import { describe, test, expect } from 'vitest'

import { APPLY_RESULT, applyFeatureUpdate } from './apply-feature-update.js'

const HABITAT_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
const HEDGEROW_ID = 'bb0e8400-e29b-41d4-a716-446655440002'

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
      watercoursesTotal: 0
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
    // BMD-427/428 not landed → empty reference data → Incomplete + 0 units.
    // The persistence path itself works (correct layer, canonical keys,
    // totals refresh) so the hedgerow journey wires up end-to-end.
    expect(result.feature).toMatchObject({
      featureId: HEDGEROW_ID,
      type: 'Native hedgerow',
      condition: 'Good',
      units: 0,
      status: 'Incomplete'
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
})
