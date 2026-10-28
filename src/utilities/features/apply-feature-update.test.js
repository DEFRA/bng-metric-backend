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

const LOW_STRATEGIC_SIGNIFICANCE =
  'Area/compensation not in local strategy/ no local strategy'

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

  test('saves null units and Incomplete when an encroachment is unselected (Scenario B)', () => {
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
      units: null,
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
      units: null,
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
            // Enhancement needs a valid Proposed Strategic Significance, otherwise the
            // edit prices it at zero (BMD-1051).
            strategicSignificance:
              'Area/compensation not in local strategy/ no local strategy',
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

  // BMD-1051 — an edit re-prices the feature with its stored strategic
  // significance. A stored Medium (imported before Medium was rejected, say)
  // is nulled and priced at zero, and the request logger hears about it.
  test('warns through the request logger when the stored strategic significance is invalid', () => {
    const project = enhancedProjectFixture()
    project.postIntervention.habitats[0].proposed.strategicSignificance =
      'Location ecologically desirable but not in local strategy'
    const logger = { warn: vi.fn() }

    const result = applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Moderate'
      },
      documentKey: 'postIntervention',
      logger
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature.units).toBeNull()
    expect(result.feature.status).toBe('Incomplete')
    expect(result.feature.proposed.strategicSignificance).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'strategic-significance-invalid',
        featureId: HABITAT_ID,
        ref: 'H1-1',
        reason: 'medium'
      }),
      expect.stringContaining('invalid proposed strategic significance')
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

  test('refreshes the hedgerow trading rules when a created hedgerow is re-typed', () => {
    // A created hedgerow delivers into its proposed type, so re-typing it moves
    // its units between bands. The stored baseline hedgerow is what it nets
    // against.
    const project = postInterventionProjectFixture()
    project.baseline.hedgerows = [{ type: 'Native hedgerow', units: 2 }]
    project.postIntervention.hedgerows[0].retentionCategory = 'Created'
    project.postIntervention.hedgerows[0].proposed.strategicSignificance =
      LOW_STRATEGIC_SIGNIFICANCE

    const asMedium = applyFeatureUpdate(project, {
      featureId: HEDGEROW_ID,
      edits: { habitatType: 'Native hedgerow with trees', condition: 'Good' },
      documentKey: 'postIntervention'
    })
    const mediumRules = asMedium.project.postIntervention.tradingRules.hedgerows
    const delivered = asMedium.feature.units
    expect(delivered).toBeGreaterThan(0)
    expect(mediumRules.medium.netUnitChange).toBe(delivered)
    expect(mediumRules.low.netUnitChange).toBe(-2)
    expect(asMedium.tradingRules.hedgerows).toEqual(mediumRules)

    const asLow = applyFeatureUpdate(asMedium.project, {
      featureId: HEDGEROW_ID,
      edits: { habitatType: 'Line of trees', condition: 'Good' },
      documentKey: 'postIntervention'
    })
    const lowRules = asLow.project.postIntervention.tradingRules.hedgerows
    expect(lowRules.medium.netUnitChange).toBe(0)
    expect(lowRules.habitatTypes.map((habitat) => habitat.habitatType)).toEqual(
      ['Line of trees', 'Native hedgerow']
    )
    expect(lowRules.low.netUnitChange).toBeCloseTo(asLow.feature.units - 2, 12)
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

  test('keeps a hedgerow rejected for its strategic significance unpriced when edited', () => {
    // BMD-1051. A post-intervention hedgerow edit is priced through the
    // hedgerow enrichment, so a created hedgerow rejected on import (Medium,
    // here) stays nulled at null units and Incomplete after a type or
    // condition edit, rather than coming back priced.
    const project = postInterventionProjectFixture()
    const hedgerow = project.postIntervention.hedgerows[0]
    hedgerow.retentionCategory = 'Created'
    hedgerow.proposed.strategicSignificance =
      'Location ecologically desirable but not in local strategy'

    const result = applyFeatureUpdate(project, {
      featureId: HEDGEROW_ID,
      edits: { habitatType: 'Native hedgerow with trees', condition: 'Good' },
      documentKey: 'postIntervention'
    })

    expect(result.feature).toMatchObject({ units: null, status: 'Incomplete' })
    expect(result.feature.proposed).toMatchObject({
      type: 'Native hedgerow with trees',
      condition: 'Good',
      strategicSignificance: null,
      rejectedStrategicSignificance:
        'Location ecologically desirable but not in local strategy'
    })
  })

  test('prices a created hedgerow edit with its creation multipliers', () => {
    // The baseline calculator priced a post-intervention hedgerow edit as if
    // the hedgerow already existed. Through the enrichment, a created hedgerow
    // takes its time to target and difficulty, and its strategic significance.
    const project = postInterventionProjectFixture()
    const hedgerow = project.postIntervention.hedgerows[0]
    hedgerow.retentionCategory = 'Created'
    hedgerow.proposed.strategicSignificance = LOW_STRATEGIC_SIGNIFICANCE

    const result = applyFeatureUpdate(project, {
      featureId: HEDGEROW_ID,
      edits: { habitatType: 'Native hedgerow with trees', condition: 'Good' },
      documentKey: 'postIntervention'
    })

    expect(result.feature.status).toBe('Complete')
    expect(result.feature.proposed.timeMultiplier).toBeLessThan(1)
    expect(result.feature.proposed.strategicSignificanceCategory).toBe('Low')
  })
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

  test('re-prices a stored Medium or blank on an edit to another feature, keeping the value', () => {
    // BMD-1051. A project saved before invalid values were rejected priced
    // Medium at ×1.10 and blank as Low. An edit to any baseline feature
    // re-derives the whole post-intervention document, so A2 and A3 are
    // re-priced though only A1 was edited: nulled, null units, Incomplete,
    // with the rejected value kept.
    const project = projectWithPostInterventionFixture()
    const MEDIUM = 'Location ecologically desirable but not in local strategy'
    for (const ref of ['A2', 'A3']) {
      project.baseline.habitats.push({
        ...project.baseline.habitats[0],
        featureId: `baseline-${ref}`,
        ref
      })
    }
    for (const [ref, strategicSignificance] of [
      ['A2', MEDIUM],
      ['A3', '']
    ]) {
      project.postIntervention.habitats.push({
        ...project.postIntervention.habitats[0],
        featureId: `post-intervention-${ref}`,
        ref,
        retentionCategory: 'Enhanced',
        units: 3,
        proposed: {
          ...project.postIntervention.habitats[0].proposed,
          condition: 'Good',
          strategicSignificance
        }
      })
    }

    const result = applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: RETYPE_EDIT
    })

    const byRef = Object.fromEntries(
      result.postIntervention.habitats.map((h) => [h.ref, h])
    )
    for (const [ref, rejected] of [
      ['A2', MEDIUM],
      ['A3', null]
    ]) {
      expect(byRef[ref]).toMatchObject({ units: null, status: 'Incomplete' })
      expect(byRef[ref].proposed).toMatchObject({
        strategicSignificance: null,
        rejectedStrategicSignificance: rejected
      })
    }
    expect(byRef.A1.status).toBe('Complete')
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

describe('applyFeatureUpdate — enhancement rules', () => {
  /** The enhanced parcel as an import that broke a rule leaves it. */
  function rejectedOnImportFixture() {
    const project = enhancedProjectFixture()
    project.baseline.habitats[0].condition = 'Poor'
    const [habitat] = project.postIntervention.habitats
    habitat.invalidEnhancement = 'low-area'
    for (const field of Object.keys(habitat.proposed)) {
      habitat.proposed[field] = null
    }
    return project
  }

  test('refuses an edit that leaves an invalid enhancement, and changes nothing', () => {
    const project = enhancedProjectFixture()
    const before = JSON.stringify(project)

    const result = applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Modified grassland',
        condition: 'Poor'
      },
      documentKey: 'postIntervention'
    })

    expect(result).toEqual({
      status: APPLY_RESULT.INVALID_ENHANCEMENT,
      type: 'habitat',
      rule: 'low-area'
    })
    expect(JSON.stringify(project)).toBe(before)
  })

  test('accepts a valid enhancement, and removes the rule its import broke', () => {
    const result = applyFeatureUpdate(rejectedOnImportFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Moderate'
      },
      documentKey: 'postIntervention'
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature).not.toHaveProperty('invalidEnhancement')
    expect(result.feature.proposed.type).toBe('Other neutral grassland')
    expect(result.project.postIntervention.habitats[0]).not.toHaveProperty(
      'invalidEnhancement'
    )
  })

  test('does not check a feature that is not enhanced', () => {
    const project = enhancedProjectFixture()
    project.postIntervention.habitats[0].retentionCategory = 'Created'

    const result = applyFeatureUpdate(project, {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Modified grassland',
        condition: 'Poor'
      },
      documentKey: 'postIntervention'
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
  })

  test('keeps the rule an import broke through a baseline edit', () => {
    const result = applyFeatureUpdate(rejectedOnImportFixture(), {
      featureId: HABITAT_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Modified grassland',
        condition: 'Moderate'
      }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    const [habitat] = result.postIntervention.habitats
    expect(habitat.baseline.condition).toBe('Moderate')
    expect(habitat.invalidEnhancement).toBe('low-area')
  })
})

describe('applyFeatureUpdate — editing the habitat reference (BMD-1061)', () => {
  const PI_HABITAT_ID = 'ee0e8400-e29b-41d4-a716-446655440005'
  const KEEP_HABITAT = {
    broadType: 'Grassland',
    habitatType: 'Modified grassland',
    condition: 'Poor'
  }

  function projectWithPostIntervention() {
    const project = projectFixture()
    project.postIntervention = {
      habitats: [
        {
          featureId: PI_HABITAT_ID,
          ref: 'A1',
          retentionCategory: 'Retained',
          area: 10_000,
          sizeSquareMetres: 10_000,
          units: 4,
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
      units: { totalUnits: 4, habitatsTotal: 4 }
    }
    return project
  }

  test('saves a new reference on a baseline area habitat', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: { ...KEEP_HABITAT, ref: 'B-A1' }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature.ref).toBe('B-A1')
    expect(result.project.baseline.habitats[0].ref).toBe('B-A1')
  })

  test('saves a new reference on a baseline hedgerow', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HEDGEROW_ID,
      edits: { habitatType: null, condition: null, ref: 'B-H1' }
    })

    expect(result.feature.ref).toBe('B-H1')
  })

  test('keeps the stored reference when the edit does not send one', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: KEEP_HABITAT
    })

    expect(result.feature.ref).toBe('A1')
  })

  test('trims the reference and truncates it to 100 characters, as an import does (BMD-1058)', () => {
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: { ...KEEP_HABITAT, ref: `  ${'x'.repeat(120)}  ` }
    })

    expect(result.feature.ref).toBe('x'.repeat(100))
  })

  test('keeps the stored reference when the edit sends a blank one', () => {
    // The route refuses a blank ref; the apply step still never stores one.
    const result = applyFeatureUpdate(projectFixture(), {
      featureId: HABITAT_ID,
      edits: { ...KEEP_HABITAT, ref: '   ' }
    })

    expect(result.feature.ref).toBe('A1')
  })

  test('renames the post-intervention row joined to the renamed baseline habitat', () => {
    const result = applyFeatureUpdate(projectWithPostIntervention(), {
      featureId: HABITAT_ID,
      edits: { ...KEEP_HABITAT, ref: 'B-A1' }
    })

    expect(result.postIntervention.habitats[0].ref).toBe('B-A1')
  })

  test('ignores a reference sent with a post-intervention edit', () => {
    const project = projectWithPostIntervention()
    const result = applyFeatureUpdate(project, {
      featureId: PI_HABITAT_ID,
      documentKey: 'postIntervention',
      edits: { ...KEEP_HABITAT, ref: 'P-A1' }
    })

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.feature.ref).toBe('A1')
  })
})

describe('applyFeatureUpdate — a BNG Service template upload’s lost habitats (BMD-1083)', () => {
  const PARENT_ID = 'dd0e8400-e29b-41d4-a716-446655440004'
  const CHILD_ID = 'ee0e8400-e29b-41d4-a716-446655440005'
  const NO_LOCAL_STRATEGY =
    'Area/compensation not in local strategy/ no local strategy'

  /** A parcel lost to a creation of another type, linked to it. */
  function templateProject({ template = true, lostHabitats } = {}) {
    const parent = {
      featureId: PARENT_ID,
      ref: 'H1',
      type: 'Modified grassland',
      broadType: 'Grassland',
      condition: 'Moderate',
      sizeSquareMetres: 10_000,
      units: 4
    }
    return {
      name: 'Template fixture',
      baseline: { habitats: [parent], units: {} },
      postIntervention: {
        habitats: [
          {
            featureId: CHILD_ID,
            parentFeatureId: PARENT_ID,
            ref: 'H1',
            retentionCategory: 'Created',
            area: 10_000,
            sizeSquareMetres: 10_000,
            units: null,
            status: 'Incomplete',
            baseline: {
              type: 'Modified grassland',
              broadType: 'Grassland',
              condition: 'Moderate'
            },
            proposed: {
              type: 'Other neutral grassland',
              broadType: 'Grassland',
              condition: 'Moderate',
              strategicSignificance: NO_LOCAL_STRATEGY,
              advanceYears: 0,
              delayYears: 0
            }
          }
        ],
        trees: [],
        hedgerows: [],
        watercourses: [],
        units: {},
        ...(template
          ? { template: { name: 'bng-service', version: '1.0' } }
          : {}),
        ...(lostHabitats ? { lostHabitats } : {})
      }
    }
  }

  const retype = (project) =>
    applyFeatureUpdate(project, {
      featureId: CHILD_ID,
      edits: {
        broadType: 'Grassland',
        habitatType: 'Modified grassland',
        condition: 'Poor'
      },
      documentKey: 'postIntervention'
    })

  test('works them out again when an edit changes a creation’s type to its parent’s', () => {
    const result = retype(
      templateProject({
        lostHabitats: [
          {
            layer: 'habitats',
            featureId: PARENT_ID,
            outcome: 'lost',
            recreatedAs: []
          }
        ]
      })
    )

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.project.postIntervention.lostHabitats).toEqual([
      expect.objectContaining({
        featureId: PARENT_ID,
        outcome: 'lostAndRecreated',
        recreatedAs: [CHILD_ID]
      })
    ])
  })

  test.each([
    ['a template upload gives it none', true, undefined],
    ['a legacy upload finds it by the old ref', false, PARENT_ID]
  ])(
    'renaming a Created area that names no parent, whose old ref a baseline parcel shares: %s (BMD-1086)',
    (_, template, parentFeatureId) => {
      const project = templateProject({ template })
      delete project.postIntervention.habitats[0].parentFeatureId

      const result = applyFeatureUpdate(project, {
        featureId: CHILD_ID,
        // The Created area edit page's whole form (BMD-1048).
        edits: {
          ref: 'H1 renamed',
          broadType: 'Grassland',
          habitatType: 'Other neutral grassland',
          condition: 'Moderate',
          strategicSignificance: 'Low',
          advanceYears: 0,
          delayYears: 0
        },
        documentKey: 'postIntervention'
      })

      expect(result.status).toBe(APPLY_RESULT.OK)
      expect(result.feature).toMatchObject({
        ref: 'H1 renamed',
        referenceEdited: true
      })
      expect(result.feature.parentFeatureId).toBe(parentFeatureId)
    }
  )

  test('gives a template upload saved before they were recorded its lost habitats', () => {
    const result = retype(templateProject())

    expect(result.lostHabitats).toEqual([
      expect.objectContaining({
        featureId: PARENT_ID,
        outcome: 'lostAndRecreated'
      })
    ])
  })

  test('keeps a parent lost and re-created when an edit saves its creation’s habitat in the short form', () => {
    const project = templateProject()
    // As imported: both sides carry the metric's prefixed label.
    project.baseline.habitats[0].type = 'Grassland - Modified grassland'
    Object.assign(project.postIntervention.habitats[0].proposed, {
      type: 'Grassland - Modified grassland',
      condition: 'Poor'
    })

    const result = retype(project)

    expect(result.feature.proposed.type).toBe('Modified grassland')
    expect(result.lostHabitats).toEqual([
      expect.objectContaining({
        featureId: PARENT_ID,
        outcome: 'lostAndRecreated',
        recreatedAs: [CHILD_ID]
      })
    ])
  })

  test('gives a legacy upload, which has none, none', () => {
    const result = retype(templateProject({ template: false }))

    expect(result.status).toBe(APPLY_RESULT.OK)
    expect(result.project.postIntervention).not.toHaveProperty('lostHabitats')
  })
})
