import { describe, test, expect, vi } from 'vitest'

import { watercourseTradingRuleStatuses } from '../project/watercourse-trading-rule-statuses.js'
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
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.type).toBe('habitat')
    expect(result.feature).toMatchObject({
      featureId: HABITAT_ID,
      broadType: 'Grassland',
      type: 'Other neutral grassland',
      condition: 'Good',
      distinctiveness: 'Medium',
      distinctivenessScore: 4,
      conditionScore: 3,
      units: 12,
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
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })
    expect(result.project.baseline.units).toEqual({
      totalUnits: 12,
      habitatsTotal: 12,
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
        habitatType: 'Other neutral grassland',
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
        habitatType: 'Other neutral grassland',
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
        habitatType: 'Other neutral grassland',
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
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      },
      expectedType: 'habitat'
    })
    expect(result.status).toBe(APPLY_RESULT.OK)
  })

  test('returns UNSUPPORTED_TYPE for a post-intervention watercourse featureId', () => {
    // Post-intervention watercourse editing is out of scope for BMD-597 — the
    // baseline path is supported (see the watercourse dispatch suite below).
    const project = postInterventionProjectFixture()
    project.postIntervention.watercourses = [
      {
        featureId: WATERCOURSE_ID,
        ref: 'W1',
        sizeMetres: 1000,
        proposed: { type: 'Other rivers and streams' }
      }
    ]
    const result = applyFeatureUpdate(project, {
      featureId: WATERCOURSE_ID,
      edits: { habitatType: 'Other rivers and streams', condition: 'Moderate' },
      documentKey: 'postIntervention'
    })
    expect(result.status).toBe(APPLY_RESULT.UNSUPPORTED_TYPE)
    expect(result.type).toBe('watercourse')
  })
})

describe('applyFeatureUpdate — watercourse dispatch', () => {
  function watercourseProjectFixture() {
    const project = projectFixture()
    project.baseline.watercourses = [
      {
        featureId: WATERCOURSE_ID,
        ref: 'W1',
        type: null,
        condition: null,
        watercourseEncroachment: null,
        riparianEncroachment: null,
        sizeMetres: 1000
      }
    ]
    return project
  }

  test('persists the watercourse shape, encroachments and units when Complete', () => {
    const result = applyFeatureUpdate(watercourseProjectFixture(), {
      featureId: WATERCOURSE_ID,
      edits: {
        habitatType: 'Ditches',
        condition: 'Moderate',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/Minor'
      }
    })
    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.type).toBe('watercourse')
    expect(result.layer).toBe('watercourses')
    // Medium (4) × Moderate (2) × 1 km × 0.8 × 0.95 = 6.08
    expect(result.feature).toMatchObject({
      type: 'Ditches',
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
      distinctiveness: 'Medium',
      distinctivenessScore: 4,
      units: 6.08,
      status: 'Complete'
    })
    expect(result.unitsTotals.watercoursesTotal).toBe(6.08)
  })

  test('saves zero units and Incomplete when an encroachment is unselected (Scenario B)', () => {
    const result = applyFeatureUpdate(watercourseProjectFixture(), {
      featureId: WATERCOURSE_ID,
      edits: {
        habitatType: 'Ditches',
        condition: 'Moderate',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: ''
      }
    })
    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature).toMatchObject({
      type: 'Ditches',
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: null,
      distinctiveness: 'Medium',
      units: 0,
      status: 'Incomplete'
    })
    expect(result.unitsTotals.watercoursesTotal).toBe(0)
  })

  test('handles a watercourse feature with no sizeMetres property', () => {
    const project = watercourseProjectFixture()
    delete project.baseline.watercourses[0].sizeMetres

    const result = applyFeatureUpdate(project, {
      featureId: WATERCOURSE_ID,
      edits: {
        habitatType: 'Ditches',
        condition: 'Moderate',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/Minor'
      }
    })

    // No size → cannot compute units, but the row still saves as Incomplete
    // with its distinctiveness resolved.
    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature).toMatchObject({
      distinctiveness: 'Medium',
      units: 0,
      status: 'Incomplete'
    })
  })

  test('offers the culvert encroachment values and computes units for a culvert', () => {
    const result = applyFeatureUpdate(watercourseProjectFixture(), {
      featureId: WATERCOURSE_ID,
      edits: {
        habitatType: 'Culvert',
        condition: 'Poor',
        watercourseEncroachment: 'N/A - Culvert',
        riparianEncroachment: 'N/A - Culvert'
      }
    })
    expect(result.status).toBe(APPLY_RESULT.OK)
    // Low (2) × Poor (1) × 1 km × 0.68 × 1 = 1.36
    expect(result.feature).toMatchObject({
      type: 'Culvert',
      distinctiveness: 'Low',
      units: 1.36,
      status: 'Complete'
    })
  })
})

describe('applyFeatureUpdate — out-of-scope distinctiveness', () => {
  function watercourseProjectFixture() {
    const project = projectFixture()
    project.baseline.watercourses = [
      {
        featureId: WATERCOURSE_ID,
        ref: 'W1',
        type: null,
        condition: null,
        watercourseEncroachment: null,
        riparianEncroachment: null,
        sizeMetres: 1000
      }
    ]
    return project
  }

  test('rejects a V.High area habitat and persists nothing', () => {
    const project = projectFixture()
    const before = JSON.stringify(project)
    const result = applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(result.status).toBe(APPLY_RESULT.OUT_OF_SCOPE)
    expect(result.type).toBe('habitat')
    expect(result.distinctiveness).toBe('V.High')
    expect(result.feature).toBeUndefined()
    // Nothing is written back to the project.
    expect(JSON.stringify(project)).toBe(before)
  })

  test('rejects a High hedgerow', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HEDGEROW_ID,
      edits: {
        habitatType: 'Species-rich native hedgerow with trees',
        condition: 'Good'
      }
    })
    expect(result.status).toBe(APPLY_RESULT.OUT_OF_SCOPE)
    expect(result.type).toBe('hedgerow')
    expect(result.distinctiveness).toBe('High')
  })

  test('rejects a High watercourse', () => {
    const result = applyFeatureUpdate(watercourseProjectFixture(), {
      featureId: WATERCOURSE_ID,
      edits: {
        habitatType: 'Other rivers and streams',
        condition: 'Moderate',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/Minor'
      }
    })
    expect(result.status).toBe(APPLY_RESULT.OUT_OF_SCOPE)
    expect(result.type).toBe('watercourse')
    expect(result.distinctiveness).toBe('High')
  })
})

function postInterventionProjectFixture() {
  return {
    name: 'PI Fixture',
    baseline: {
      units: {
        totalUnits: 10,
        habitatsTotal: 6,
        hedgerowsTotal: 2,
        watercoursesTotal: 1,
        treesTotal: 1,
        treesUrbanTotal: 1,
        treesRuralTotal: 0
      }
    },
    postIntervention: {
      habitats: [
        {
          featureId: HABITAT_ID,
          ref: 'H1-1',
          retentionCategory: 'Retained',
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
          retentionCategory: 'Retained',
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

/**
 * A post-intervention project whose single parcel is Enhanced, so an edit to the
 * proposed habitat moves units between habitat types — the case the trading
 * rules have to recompute for. The stored baseline carries the parcel's
 * baseline units, which is where the trading rules read them from.
 */
function enhancedProjectFixture() {
  return {
    name: 'Enhanced PI Fixture',
    baseline: {
      habitats: [
        {
          featureId: HABITAT_ID,
          ref: 'H1-1',
          type: 'Modified grassland',
          broadType: 'Grassland',
          units: 3
        }
      ],
      units: { totalUnits: 3, habitatsTotal: 3 }
    },
    postIntervention: {
      habitats: [
        {
          featureId: HABITAT_ID,
          ref: 'H1-1',
          retentionCategory: 'Enhanced',
          area: 10_000,
          sizeSquareMetres: 10_000,
          units: null,
          status: 'Incomplete',
          baseline: {
            type: 'Modified grassland',
            broadType: 'Grassland',
            condition: 'Poor'
          },
          proposed: {
            type: 'Modified grassland',
            broadType: 'Grassland',
            condition: 'Moderate',
            advanceYears: 0,
            delayYears: 0
          }
        }
      ],
      trees: [],
      hedgerows: [],
      watercourses: [],
      units: {}
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

  test('enriches baseline sub-object with informational scores', () => {
    const result = applyFeatureUpdate(postInterventionProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      },
      documentKey: 'postIntervention'
    })

    expect(result.feature.baseline.type).toBe('Modified grassland')
    expect(result.feature.baseline.condition).toBe('Moderate')
    expect(result.feature.baseline.distinctiveness).toBeTruthy()
    expect(typeof result.feature.baseline.conditionScore).toBe('number')
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
    expect(result.unitsTotals).toEqual(
      expect.objectContaining({
        habitatsNetUnitChange:
          result.project.postIntervention.units.habitatsTotal - 7,
        habitatsNetUnitChangePercentage:
          ((result.project.postIntervention.units.habitatsTotal - 7) / 7) * 100,
        hedgerowsNetUnitChange: -2,
        hedgerowsNetUnitChangePercentage: -100,
        watercoursesNetUnitChange: -1,
        watercoursesNetUnitChangePercentage: -100
      })
    )
  })

  test('refreshes postIntervention.tradingRules after an edit', () => {
    // Enhancement delivers into the proposed habitat, so re-typing the parcel
    // moves its units between bands: the Low baseline habitat keeps its deficit
    // and the new Medium habitat takes the delivered units.
    const result = applyFeatureUpdate(enhancedProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Moderate'
      },
      documentKey: 'postIntervention'
    })

    const { areaHabitats } = result.project.postIntervention.tradingRules
    expect(areaHabitats.habitatTypes).toEqual([
      expect.objectContaining({
        habitatType: 'Grassland - Modified grassland',
        distinctiveness: 'Low',
        netUnitChange: -3
      }),
      expect.objectContaining({
        habitatType: 'Grassland - Other neutral grassland',
        broadHabitat: 'Grassland',
        distinctiveness: 'Medium'
      })
    ])
    expect(areaHabitats.medium.surplus).toBeGreaterThan(0)
    expect(areaHabitats.low.netUnitChange).toBe(-3)
    expect(result.tradingRules).toEqual(
      result.project.postIntervention.tradingRules
    )
  })

  test('re-typing an enhanced parcel into a Low habitat empties the Medium band', () => {
    const result = applyFeatureUpdate(enhancedProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Urban',
        habitatType: 'Allotments',
        condition: 'Moderate'
      },
      documentKey: 'postIntervention'
    })

    const { areaHabitats } = result.project.postIntervention.tradingRules
    expect(areaHabitats.medium.broadHabitats).toEqual([])
    expect(areaHabitats.medium.surplus).toBe(0)
    expect(areaHabitats.low.cumulativeAvailability).toBe(
      areaHabitats.low.netUnitChange
    )
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

describe('applyFeatureUpdate — baseline edit with a post-intervention document', () => {
  const PI_HABITAT_ID = 'dd0e8400-e29b-41d4-a716-446655440004'
  const ONE_HECTARE = 10_000

  // The post-intervention document keeps its own copy of the baseline (the
  // Baseline * GeoPackage columns), joined back to the baseline document on
  // `ref` — the two documents assign featureIds independently.
  function projectWithPostInterventionFixture() {
    return {
      name: 'Baseline edit fixture',
      baseline: {
        habitats: [
          {
            featureId: HABITAT_ID,
            ref: 'A1',
            type: 'Modified grassland',
            broadType: 'Grassland',
            condition: 'Poor',
            area: ONE_HECTARE,
            sizeSquareMetres: ONE_HECTARE,
            units: 2,
            status: 'Complete'
          }
        ],
        trees: [],
        hedgerows: [],
        watercourses: [],
        units: {
          totalUnits: 2,
          habitatsTotal: 2,
          hedgerowsTotal: 0,
          watercoursesTotal: 0
        }
      },
      postIntervention: {
        habitats: [
          {
            featureId: PI_HABITAT_ID,
            ref: 'A1',
            retentionCategory: 'Retained',
            area: ONE_HECTARE,
            sizeSquareMetres: ONE_HECTARE,
            units: 2,
            status: 'Complete',
            baseline: {
              type: 'Modified grassland',
              broadType: 'Grassland',
              condition: 'Poor'
            },
            proposed: {
              type: 'Modified grassland',
              broadType: 'Grassland',
              condition: 'Poor',
              advanceYears: 0,
              delayYears: 0
            }
          }
        ],
        trees: [],
        hedgerows: [],
        watercourses: [],
        units: { totalUnits: 2, habitatsTotal: 2 }
      }
    }
  }

  const RETYPE_EDIT = {
    broadType: 'Grassland',
    habitatType: 'Other neutral grassland',
    condition: 'Good'
  }

  test('brings the post-intervention copy of the baseline with the edit', () => {
    const result = applyFeatureUpdate(projectWithPostInterventionFixture(), {
      featureId: HABITAT_ID,
      edits: RETYPE_EDIT
    })

    const [habitat] = result.postIntervention.habitats
    expect(habitat.baseline).toMatchObject({
      type: 'Other neutral grassland',
      broadType: 'Grassland',
      condition: 'Good'
    })
    // Retained, so the proposed side was a copy of the baseline and moves too.
    expect(habitat.proposed).toMatchObject({
      type: 'Other neutral grassland',
      condition: 'Good'
    })
  })

  test('recomputes the trading-rules figures against the edited baseline', () => {
    const result = applyFeatureUpdate(projectWithPostInterventionFixture(), {
      featureId: HABITAT_ID,
      edits: RETYPE_EDIT
    })

    const { areaHabitats } = result.postIntervention.tradingRules
    // The Low-band habitat the stored figures were measured against is gone:
    // both sides of the comparison now name the habitat the user chose.
    expect(areaHabitats.habitatTypes).toEqual([
      expect.objectContaining({
        habitatType: 'Grassland - Other neutral grassland',
        distinctiveness: 'Medium',
        // A Retained parcel delivers exactly what the baseline holds, so it
        // nets out — only true once both sides were re-derived together.
        netUnitChange: 0
      })
    ])
    expect(areaHabitats.medium.deficit).toBe(0)
  })

  test('recomputes the post-intervention units and net unit change', () => {
    const result = applyFeatureUpdate(projectWithPostInterventionFixture(), {
      featureId: HABITAT_ID,
      edits: RETYPE_EDIT
    })

    expect(result.postIntervention.units.habitatsTotal).toBe(
      result.unitsTotals.habitatsTotal
    )
    expect(result.postIntervention.units.habitatsNetUnitChange).toBe(0)
    expect(result.postIntervention.units.habitatsNetUnitChangePercentage).toBe(
      0
    )
  })

  test('leaves the caller’s stored document untouched', () => {
    const project = projectWithPostInterventionFixture()
    const stored = structuredClone(project.postIntervention)

    const result = applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: RETYPE_EDIT
    })

    expect(project.postIntervention).toEqual(stored)
    expect(result.project.postIntervention).toBe(result.postIntervention)
  })

  test('editing a baseline watercourse changes the watercourse trading-rules status', () => {
    // A post-intervention watercourse cannot be edited here. The watercourse
    // edit that moves the figures is a baseline edit: it re-derives the
    // post-intervention document, including tradingRules.watercourses. The
    // stored figures say the Medium band is in deficit; the retained ditch
    // cancels, so the status must leave Not met.
    const project = projectWithPostInterventionFixture()
    const ditch = {
      type: 'Ditches',
      condition: 'Poor',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor'
    }
    project.baseline.watercourses = [
      {
        featureId: WATERCOURSE_ID,
        ref: 'W1',
        sizeMetres: 1000,
        ...ditch
      }
    ]
    project.postIntervention.watercourses = [
      {
        featureId: 'ee0e8400-e29b-41d4-a716-446655440005',
        ref: 'W1',
        retentionCategory: 'Retained',
        sizeMetres: 1000,
        baseline: { ...ditch },
        proposed: { ...ditch, advanceYears: 0, delayYears: 0 }
      }
    ]
    project.postIntervention.tradingRules = {
      watercourses: {
        habitats: [],
        medium: { surplus: 0, deficit: -4 },
        low: { netUnitChange: 0, cumulativeAvailability: -4 }
      }
    }

    expect(
      watercourseTradingRuleStatuses(project.postIntervention, project.baseline)
        .overall
    ).toBe('Not met')

    const result = applyFeatureUpdate(project, {
      featureId: WATERCOURSE_ID,
      edits: { habitatType: 'Ditches', condition: 'Good', ...ditch }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.type).toBe('watercourse')
    expect(
      watercourseTradingRuleStatuses(
        result.postIntervention,
        result.project.baseline
      ).overall
    ).toBe('Met')
  })

  test('returns no post-intervention document when the project has none', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: RETYPE_EDIT
    })

    expect(result.postIntervention).toBeNull()
    expect(result.project.postIntervention).toBeUndefined()
  })

  test('does not re-derive on a post-intervention edit', () => {
    // That edit is already recomputing the document it belongs to.
    const result = applyFeatureUpdate(postInterventionProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      },
      documentKey: 'postIntervention'
    })

    expect(result.postIntervention).toBeNull()
  })

  test('warns about a Retained row with no baseline feature to match', () => {
    const project = projectWithPostInterventionFixture()
    project.postIntervention.habitats[0].ref = 'Z9'
    const logger = { warn: vi.fn() }

    applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: RETYPE_EDIT,
      logger
    })

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Z9'))
  })
})

describe('applyFeatureUpdate — a baseline ref shared by two features', () => {
  const SECOND_HABITAT_ID = 'ff0e8400-e29b-41d4-a716-446655440006'
  const PI_HABITAT_ID = 'dd0e8400-e29b-41d4-a716-446655440007'
  const ONE_HECTARE = 10_000

  function areaHabitat(featureId, overrides) {
    return {
      featureId,
      ref: 'A1',
      type: 'Modified grassland',
      broadType: 'Grassland',
      condition: 'Poor',
      area: ONE_HECTARE,
      sizeSquareMetres: ONE_HECTARE,
      units: 2,
      status: 'Complete',
      ...overrides
    }
  }

  // Both parcels carry ref A1 — legitimate in the metric where parcels combine
  // or split. The post-intervention row's imported baseline values name the
  // grassland one.
  function sharedRefProjectFixture() {
    return {
      name: 'Shared ref fixture',
      baseline: {
        habitats: [
          areaHabitat(HABITAT_ID),
          areaHabitat(SECOND_HABITAT_ID, {
            type: 'Allotments',
            broadType: 'Urban'
          })
        ],
        trees: [],
        hedgerows: [],
        watercourses: [],
        units: {
          totalUnits: 4,
          habitatsTotal: 4,
          hedgerowsTotal: 0,
          watercoursesTotal: 0
        }
      },
      postIntervention: {
        habitats: [
          {
            featureId: PI_HABITAT_ID,
            ref: 'A1',
            retentionCategory: 'Retained',
            area: ONE_HECTARE,
            sizeSquareMetres: ONE_HECTARE,
            units: 2,
            status: 'Complete',
            baseline: {
              type: 'Modified grassland',
              broadType: 'Grassland',
              condition: 'Poor'
            },
            proposed: {
              type: 'Modified grassland',
              broadType: 'Grassland',
              condition: 'Poor',
              advanceYears: 0,
              delayYears: 0
            }
          }
        ],
        trees: [],
        hedgerows: [],
        watercourses: [],
        units: { totalUnits: 2, habitatsTotal: 2 }
      }
    }
  }

  test('follows the parcel the edit moved, not the other one sharing its ref', () => {
    // Only resolvable against the PRE-edit baseline: after the edit, the parcel
    // the row describes no longer carries the values the row imported.
    const logger = { warn: vi.fn() }

    const result = applyFeatureUpdate(sharedRefProjectFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      },
      logger
    })

    expect(result.postIntervention.habitats[0].baseline).toMatchObject({
      type: 'Other neutral grassland',
      broadType: 'Grassland',
      condition: 'Good'
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('leaves the row alone when the edit was to the other parcel', () => {
    const result = applyFeatureUpdate(sharedRefProjectFixture(), {
      featureId: SECOND_HABITAT_ID,
      edits: {
        broadType: 'Urban',
        habitatType: 'Vacant/derelict land/bareground',
        condition: 'Poor'
      }
    })

    // The row named the grassland parcel, which this edit did not touch.
    expect(result.postIntervention.habitats[0].baseline).toMatchObject({
      type: 'Modified grassland',
      condition: 'Poor'
    })
  })
})
