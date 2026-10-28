import { describe, expect, test, vi } from 'vitest'
import { summariseUnitTypes } from '../../../services/report/unit-summary.js'

import {
  rederivePostInterventionFromBaseline,
  resyncPostInterventionBaselineSide
} from './resync-post-intervention-baseline.js'

import {
  makeAreaHabitat,
  makeHedgerow,
  makeWatercourse,
  makeLostHedgerow,
  makeLostWatercourse
} from './enrich-post-intervention-units.fixtures.js'

const MODIFIED_GRASSLAND = 'Modified grassland' // Grassland, Low
const NEUTRAL_GRASSLAND = 'Other neutral grassland' // Grassland, Medium
const ONE_HECTARE = 10_000

/**
 * @param {object} overrides
 * @returns {object} a baseline area habitat
 */
function baselineHabitat({
  featureId = 'baseline-1',
  ref = 'A1',
  type = MODIFIED_GRASSLAND,
  broadType = 'Grassland',
  condition = 'Poor',
  strategicSignificance = 'Low',
  units = 2
} = {}) {
  return {
    featureId,
    ref,
    type,
    broadType,
    condition,
    strategicSignificance,
    area: ONE_HECTARE,
    sizeSquareMetres: ONE_HECTARE,
    units,
    status: 'Complete'
  }
}

/**
 * @param {object} overrides
 * @returns {object} a post-intervention area habitat
 */
function postInterventionHabitat({
  featureId = 'pi-1',
  ref = 'A1',
  retentionCategory = 'Retained',
  baseline = {},
  proposed = {}
} = {}) {
  return {
    featureId,
    ref,
    retentionCategory,
    area: ONE_HECTARE,
    sizeSquareMetres: ONE_HECTARE,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: MODIFIED_GRASSLAND,
      broadType: 'Grassland',
      condition: 'Poor',
      strategicSignificance: 'Low',
      ...baseline
    },
    proposed: {
      type: MODIFIED_GRASSLAND,
      broadType: 'Grassland',
      condition: 'Poor',
      strategicSignificance: 'Low',
      advanceYears: 0,
      delayYears: 0,
      ...proposed
    }
  }
}

describe('resyncPostInterventionBaselineSide', () => {
  test('copies the edited baseline identity onto the matching post-intervention row', () => {
    const postIntervention = { habitats: [postInterventionHabitat()] }

    const changed = resyncPostInterventionBaselineSide(postIntervention, {
      baseline: {
        habitats: [
          baselineHabitat({ type: NEUTRAL_GRASSLAND, condition: 'Good' })
        ]
      }
    })

    expect(changed).toBe(1)
    expect(postIntervention.habitats[0].baseline).toMatchObject({
      type: NEUTRAL_GRASSLAND,
      broadType: 'Grassland',
      condition: 'Good'
    })
  })

  test('moves a Retained row’s proposed copy with the baseline it was copied from', () => {
    // copyRetainedProposedFromBaseline filled the proposed side from baseline at
    // extract time, so the two must stay in step.
    const postIntervention = { habitats: [postInterventionHabitat()] }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline: {
        habitats: [
          baselineHabitat({ type: NEUTRAL_GRASSLAND, condition: 'Good' })
        ]
      }
    })

    expect(postIntervention.habitats[0].proposed).toMatchObject({
      type: NEUTRAL_GRASSLAND,
      condition: 'Good'
    })
  })

  test('leaves a Retained proposed value the GeoPackage supplied itself', () => {
    const postIntervention = {
      habitats: [
        postInterventionHabitat({
          proposed: { type: NEUTRAL_GRASSLAND, condition: 'Moderate' }
        })
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline: {
        habitats: [baselineHabitat({ type: 'Allotments', broadType: 'Urban' })]
      }
    })

    const [habitat] = postIntervention.habitats
    expect(habitat.baseline.type).toBe('Allotments')
    // Already diverged from the baseline copy, so it is the file's own value.
    expect(habitat.proposed.type).toBe(NEUTRAL_GRASSLAND)
    expect(habitat.proposed.condition).toBe('Moderate')
  })

  test('never touches the proposed side of a feature that is not Retained', () => {
    const postIntervention = {
      habitats: [
        postInterventionHabitat({
          retentionCategory: 'Enhanced',
          proposed: { condition: 'Poor' }
        })
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline: { habitats: [baselineHabitat({ condition: 'Good' })] }
    })

    const [habitat] = postIntervention.habitats
    expect(habitat.baseline.condition).toBe('Good')
    expect(habitat.proposed.condition).toBe('Poor')
  })

  test('leaves a row whose ref is blank as imported', () => {
    const postIntervention = {
      habitats: [postInterventionHabitat({ ref: '  ' })]
    }

    const changed = resyncPostInterventionBaselineSide(postIntervention, {
      baseline: {
        habitats: [baselineHabitat({ ref: null, type: NEUTRAL_GRASSLAND })]
      }
    })

    expect(changed).toBe(0)
    expect(postIntervention.habitats[0].baseline.type).toBe(MODIFIED_GRASSLAND)
  })

  test('only propagates fields the baseline document actually carries', () => {
    const postIntervention = { habitats: [postInterventionHabitat()] }
    const source = baselineHabitat({ type: NEUTRAL_GRASSLAND })
    delete source.strategicSignificance

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline: { habitats: [source] }
    })

    expect(postIntervention.habitats[0].baseline.strategicSignificance).toBe(
      'Low'
    )
  })

  test('warns when a Retained row has no baseline feature to measure against', () => {
    const logger = { warn: vi.fn() }

    resyncPostInterventionBaselineSide(
      { habitats: [postInterventionHabitat({ ref: 'Z9' })] },
      { baseline: { habitats: [baselineHabitat()] } },
      logger
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain('Z9')
  })

  test('says nothing about a Created row, which is new habitat by definition', () => {
    const logger = { warn: vi.fn() }

    resyncPostInterventionBaselineSide(
      {
        habitats: [
          postInterventionHabitat({ ref: 'Z9', retentionCategory: 'Created' })
        ]
      },
      { baseline: { habitats: [baselineHabitat()] } },
      logger
    )

    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('re-syncs hedgerows and watercourses on their own identity fields', () => {
    const postIntervention = {
      hedgerows: [
        {
          featureId: 'pi-h1',
          ref: 'H1',
          retentionCategory: 'Retained',
          sizeMetres: 500,
          baseline: { type: 'Native hedgerow', condition: 'Poor' },
          proposed: { type: 'Native hedgerow', condition: 'Poor' }
        }
      ],
      watercourses: [
        {
          featureId: 'pi-w1',
          ref: 'W1',
          retentionCategory: 'Retained',
          sizeMetres: 500,
          baseline: {
            type: 'Ditches',
            condition: 'Poor',
            riparianEncroachment: 'Minor/Minor',
            watercourseEncroachment: 'Minor'
          },
          proposed: {
            type: 'Ditches',
            condition: 'Poor',
            riparianEncroachment: 'Minor/Minor',
            watercourseEncroachment: 'Minor'
          }
        }
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline: {
        hedgerows: [
          {
            featureId: 'b-h1',
            ref: 'H1',
            type: 'Species-rich native hedgerow',
            condition: 'Good'
          }
        ],
        watercourses: [
          {
            featureId: 'b-w1',
            ref: 'W1',
            type: 'Ditches',
            condition: 'Moderate',
            riparianEncroachment: 'Extensive/Extensive',
            watercourseEncroachment: 'Extensive'
          }
        ]
      }
    })

    expect(postIntervention.hedgerows[0].baseline).toMatchObject({
      type: 'Species-rich native hedgerow',
      condition: 'Good'
    })
    expect(postIntervention.watercourses[0].baseline).toMatchObject({
      condition: 'Moderate',
      riparianEncroachment: 'Extensive/Extensive',
      watercourseEncroachment: 'Extensive'
    })
  })

  test('keeps a hedgerow and a watercourse sharing a ref independent', () => {
    // Refs are only meaningful within a layer. The existing linear length map
    // (buildBaselineLinearLengthByRef) puts both layers in one map, which is a
    // separate defect — this join must not repeat it.
    const postIntervention = {
      hedgerows: [
        {
          featureId: 'pi-h',
          ref: 'X1',
          retentionCategory: 'Retained',
          baseline: { type: 'Native hedgerow', condition: 'Poor' },
          proposed: {}
        }
      ],
      watercourses: [
        {
          featureId: 'pi-w',
          ref: 'X1',
          retentionCategory: 'Retained',
          baseline: { type: 'Ditches', condition: 'Poor' },
          proposed: {}
        }
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline: {
        hedgerows: [
          {
            featureId: 'b-h',
            ref: 'X1',
            type: 'Species-rich native hedgerow',
            condition: 'Good'
          }
        ],
        watercourses: [
          {
            featureId: 'b-w',
            ref: 'X1',
            type: 'Other rivers and streams',
            condition: 'Moderate'
          }
        ]
      }
    })

    expect(postIntervention.hedgerows[0].baseline.type).toBe(
      'Species-rich native hedgerow'
    )
    expect(postIntervention.watercourses[0].baseline.type).toBe(
      'Other rivers and streams'
    )
  })
})

describe('resyncPostInterventionBaselineSide — refs shared by several features', () => {
  // The metric allows several features to carry one ref where parcels combine
  // or split, so the join is one-to-many in both directions.

  test('a split re-syncs every post-intervention row from the one baseline row', () => {
    const postIntervention = {
      habitats: [
        postInterventionHabitat({ featureId: 'pi-1' }),
        postInterventionHabitat({ featureId: 'pi-2' }),
        postInterventionHabitat({ featureId: 'pi-3' })
      ]
    }

    const changed = resyncPostInterventionBaselineSide(postIntervention, {
      baseline: {
        habitats: [
          baselineHabitat({ type: NEUTRAL_GRASSLAND, condition: 'Good' })
        ]
      }
    })

    expect(changed).toBe(3)
    for (const habitat of postIntervention.habitats) {
      expect(habitat.baseline).toMatchObject({
        type: NEUTRAL_GRASSLAND,
        condition: 'Good'
      })
    }
  })

  test('identifies which of two baseline features sharing a ref the row describes', () => {
    // A1 is carried by two parcels. The user edited the grassland one; the row's
    // imported values still match it as it stood BEFORE that edit, which is what
    // identifies it — matching on the current values could not, since the edit
    // is exactly what changed them.
    const previousBaseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-grass', type: MODIFIED_GRASSLAND }),
        baselineHabitat({
          featureId: 'b-urban',
          type: 'Allotments',
          broadType: 'Urban'
        })
      ]
    }
    const baseline = {
      habitats: [
        baselineHabitat({
          featureId: 'b-grass',
          type: NEUTRAL_GRASSLAND,
          condition: 'Good'
        }),
        baselineHabitat({
          featureId: 'b-urban',
          type: 'Allotments',
          broadType: 'Urban'
        })
      ]
    }
    const postIntervention = { habitats: [postInterventionHabitat()] }
    const logger = { warn: vi.fn() }

    const changed = resyncPostInterventionBaselineSide(
      postIntervention,
      { baseline, previousBaseline },
      logger
    )

    expect(changed).toBe(1)
    expect(postIntervention.habitats[0].baseline).toMatchObject({
      type: NEUTRAL_GRASSLAND,
      broadType: 'Grassland',
      condition: 'Good'
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('leaves the row alone when no feature sharing the ref carries its values', () => {
    const logger = { warn: vi.fn() }
    const postIntervention = { habitats: [postInterventionHabitat()] }

    const changed = resyncPostInterventionBaselineSide(
      postIntervention,
      {
        baseline: {
          habitats: [
            baselineHabitat({ featureId: 'b-1', type: 'Allotments' }),
            baselineHabitat({ featureId: 'b-2', type: NEUTRAL_GRASSLAND })
          ]
        }
      },
      logger
    )

    expect(changed).toBe(0)
    expect(postIntervention.habitats[0].baseline.type).toBe(MODIFIED_GRASSLAND)
    expect(logger.warn.mock.calls[0][0]).toMatch(
      /2 baseline features share ref "A1" and none carries/
    )
  })

  test('refuses to guess between two indistinguishable features sharing a ref', () => {
    // Both carried the row's values before the edit, and only one of them moved.
    // Nothing in the data says which one the row followed.
    const logger = { warn: vi.fn() }
    const previousBaseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-1' }),
        baselineHabitat({ featureId: 'b-2' })
      ]
    }
    const baseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-1', type: NEUTRAL_GRASSLAND }),
        baselineHabitat({ featureId: 'b-2' })
      ]
    }
    const postIntervention = { habitats: [postInterventionHabitat()] }

    const changed = resyncPostInterventionBaselineSide(
      postIntervention,
      { baseline, previousBaseline },
      logger
    )

    expect(changed).toBe(0)
    expect(postIntervention.habitats[0].baseline.type).toBe(MODIFIED_GRASSLAND)
    expect(logger.warn.mock.calls[0][0]).toMatch(
      /more than one carries this row's imported baseline values/
    )
  })

  test('resolves an ambiguous ref on the layer the Met / Not-met verdict reads', () => {
    // Upload allows repeated Parcel Refs (BMD-1058), so this reaches the area
    // layer, and the verdict must not depend on which row a ref picks.
    const previousBaseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-grass', units: 2 }),
        baselineHabitat({
          featureId: 'b-urban',
          type: 'Allotments',
          broadType: 'Urban',
          units: 2
        })
      ]
    }
    const baseline = {
      habitats: [
        baselineHabitat({
          featureId: 'b-grass',
          type: NEUTRAL_GRASSLAND,
          condition: 'Good',
          units: 12
        }),
        baselineHabitat({
          featureId: 'b-urban',
          type: 'Allotments',
          broadType: 'Urban',
          units: 2
        })
      ],
      units: { totalUnits: 14, habitatsTotal: 14 }
    }

    const rederived = rederivePostInterventionFromBaseline(
      { habitats: [postInterventionHabitat()], trees: [], units: {} },
      { baseline, previousBaseline }
    )

    expect(
      rederived.tradingRules.areaHabitats.habitatTypes.map(
        (entry) => entry.habitatType
      )
    ).toContain('Grassland - Other neutral grassland')
  })
})

describe('rederivePostInterventionFromBaseline', () => {
  test.each([
    ['habitats', makeAreaHabitat],
    ['trees', makeAreaHabitat],
    ['hedgerows', makeHedgerow],
    ['watercourses', makeWatercourse]
  ])(
    'keeps retained %s with null proposed condition Incomplete after a baseline edit',
    (layer, makeFeature) => {
      const feature = makeFeature()
      feature.proposed.condition = null
      const stored = { [layer]: [feature] }
      const before = structuredClone(stored)
      const rederived = rederivePostInterventionFromBaseline(stored, {
        baseline: {
          [layer]: [
            {
              ...feature.baseline,
              ref: feature.ref,
              featureId: 'baseline-1',
              condition: 'Poor'
            }
          ]
        }
      })
      expect(rederived[layer][0].baseline.condition).toBe('Poor')
      expect(rederived[layer][0].proposed.condition).toBeNull()
      expect(rederived[layer][0].status).toBe('Incomplete')
      expect(stored).toEqual(before)
    }
  )

  test.each([null, '', '   ', 'unknown encroachment'])(
    'recalculates legacy retained watercourses with encroachment %j as Incomplete',
    (value) => {
      const feature = makeWatercourse({ units: 12, status: 'Complete' })
      feature.baseline.watercourseEncroachment = value
      feature.proposed.watercourseEncroachment = value
      const logger = { warn: vi.fn() }
      const rederived = rederivePostInterventionFromBaseline(
        { watercourses: [feature] },
        { baseline: {} },
        logger
      )
      expect(rederived.watercourses[0].status).toBe('Incomplete')
      expect(rederived.watercourses[0].units).toBeNull()
      expect(rederived.units.watercoursesTotal).toBe(0)
      expect(rederived.units.totalUnits).toBe(0)
      const summary = summariseUnitTypes(null, {
        ...rederived,
        documentCounts: { watercourses: 1 }
      }).find((item) => item.key === 'watercourses')
      expect(summary.postInterventionUnits).toBe('0.00 units')
      expect(logger.warn).toHaveBeenCalled()
      expect(feature.units).toBe(12)
      expect(feature.status).toBe('Complete')
    }
  )

  test.each([
    ['hedgerows', makeLostHedgerow],
    ['watercourses', makeLostWatercourse]
  ])(
    'preserves Complete zero-unit legacy Lost %s without proposed attributes',
    (layer, makeFeature) => {
      const feature = makeFeature()
      feature.proposed = { type: null, condition: null }
      const rederived = rederivePostInterventionFromBaseline(
        { [layer]: [feature] },
        { baseline: {} }
      )
      expect(rederived[layer][0].status).toBe('Complete')
      expect(rederived[layer][0].units).toBe(0)
    }
  )

  test('returns null when the project has no post-intervention document', () => {
    expect(
      rederivePostInterventionFromBaseline(null, { baseline: {} })
    ).toBeNull()
    expect(
      rederivePostInterventionFromBaseline(undefined, { baseline: {} })
    ).toBeNull()
  })

  test('does not mutate the stored document', () => {
    const stored = { habitats: [postInterventionHabitat()], units: {} }
    const before = structuredClone(stored)

    rederivePostInterventionFromBaseline(stored, {
      baseline: {
        habitats: [
          baselineHabitat({ type: NEUTRAL_GRASSLAND, condition: 'Good' })
        ],
        units: { totalUnits: 6, habitatsTotal: 6 }
      }
    })

    expect(stored).toEqual(before)
  })

  test('recomputes the trading-rules figures against the edited baseline', () => {
    const rederived = rederivePostInterventionFromBaseline(
      { habitats: [postInterventionHabitat()], trees: [], units: {} },
      {
        baseline: {
          habitats: [
            baselineHabitat({
              type: NEUTRAL_GRASSLAND,
              condition: 'Good',
              units: 12
            })
          ],
          units: { totalUnits: 12, habitatsTotal: 12 }
        }
      }
    )

    // The Low-band habitat the figures used to be measured against is gone —
    // both sides of the comparison now name the edited habitat.
    expect(
      rederived.tradingRules.areaHabitats.habitatTypes.map(
        (entry) => entry.habitatType
      )
    ).toEqual(['Grassland - Other neutral grassland'])
    // A Retained parcel delivers exactly what the baseline holds, so it nets
    // out — which is only true once the post-intervention side was re-synced.
    expect(
      rederived.tradingRules.areaHabitats.habitatTypes[0].netUnitChange
    ).toBe(0)
    expect(rederived.units.habitatsTotal).toBe(12)
    expect(rederived.units.habitatsNetUnitChange).toBe(0)
  })
})

describe('rederivePostInterventionFromBaseline — a BNG Service template upload’s lineage outcomes (BMD-1083)', () => {
  const NO_ENCROACHMENT = {
    watercourseEncroachment: 'No Encroachment',
    riparianEncroachment: 'No Encroachment/No Encroachment'
  }

  /** A baseline ditch, 100 m, in `condition`. */
  const ditch = (condition = 'Moderate') => ({
    featureId: 'baseline-r1',
    ref: 'R1',
    type: 'Ditches',
    condition,
    strategicSignificance: 'Low',
    sizeMetres: 100,
    ...NO_ENCROACHMENT
  })

  /** The ditch Created again with only more encroachment, 10 years in advance. */
  const encroached = () =>
    makeWatercourse({
      featureId: 'pi-r1',
      ref: 'R1',
      retentionCategory: 'Created',
      parentFeatureId: 'baseline-r1',
      sizeMetres: 100,
      baseline: { type: 'Ditches', condition: 'Moderate', ...NO_ENCROACHMENT },
      proposed: {
        type: 'Ditches',
        condition: 'Moderate',
        watercourseEncroachment: 'Major',
        riparianEncroachment: 'No Encroachment/No Encroachment',
        strategicSignificance: 'Low',
        advanceYears: 10,
        delayYears: 0
      }
    })

  test('keeps the advance of an encroachment-only change the baseline edit leaves one', () => {
    const rederived = rederivePostInterventionFromBaseline(
      { watercourses: [encroached()], lostHabitats: [] },
      { baseline: { watercourses: [ditch()] } }
    )

    expect(rederived.watercourses[0].proposed.advanceYears).toBe(10)
  })

  test('nulls the advance once a baseline edit makes it more than an encroachment-only change, so it is re-priced Incomplete', () => {
    const logger = { warn: vi.fn() }

    const rederived = rederivePostInterventionFromBaseline(
      { watercourses: [encroached()], lostHabitats: [] },
      { baseline: { watercourses: [ditch('Good')] } },
      logger
    )

    expect(rederived.watercourses[0].proposed.advanceYears).toBeNull()
    expect(rederived.watercourses[0].status).toBe('Incomplete')
    expect(rederived.watercourses[0].units).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('advance nulled')
    )
  })

  test('works out the lost habitats again against the edited baseline', () => {
    const rederived = rederivePostInterventionFromBaseline(
      { watercourses: [encroached()], lostHabitats: [] },
      { baseline: { watercourses: [ditch('Good')] } }
    )

    expect(rederived.lostHabitats).toEqual([
      expect.objectContaining({
        featureId: 'baseline-r1',
        outcome: 'lostAndRecreated',
        lostSizeMetres: 100,
        recreatedAs: ['pi-r1']
      })
    ])
  })

  test('leaves a legacy upload, which has no lost habitats, without them', () => {
    const rederived = rederivePostInterventionFromBaseline(
      { watercourses: [encroached()] },
      { baseline: { watercourses: [ditch('Good')] } }
    )

    expect(rederived).not.toHaveProperty('lostHabitats')
    expect(rederived.watercourses[0].proposed.advanceYears).toBe(10)
  })
})

describe('resyncPostInterventionBaselineSide — a renamed baseline ref (BMD-1061)', () => {
  test('carries the new ref onto the post-intervention row joined to the feature', () => {
    const previousBaseline = { habitats: [baselineHabitat()] }
    const baseline = { habitats: [baselineHabitat({ ref: 'B-A1' })] }
    const postIntervention = { habitats: [postInterventionHabitat()] }

    const changed = resyncPostInterventionBaselineSide(postIntervention, {
      baseline,
      previousBaseline
    })

    expect(changed).toBe(1)
    expect(postIntervention.habitats[0].ref).toBe('B-A1')
  })

  test('renames every row of a split', () => {
    const previousBaseline = { habitats: [baselineHabitat()] }
    const baseline = { habitats: [baselineHabitat({ ref: 'B-A1' })] }
    const postIntervention = {
      habitats: [
        postInterventionHabitat({ featureId: 'pi-1' }),
        postInterventionHabitat({
          featureId: 'pi-2',
          retentionCategory: 'Created'
        })
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline,
      previousBaseline
    })

    expect(postIntervention.habitats.map((h) => h.ref)).toEqual([
      'B-A1',
      'B-A1'
    ])
  })

  test('renames only the row resolved to the renamed one of two features sharing a ref', () => {
    const previousBaseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-grass' }),
        baselineHabitat({
          featureId: 'b-urban',
          type: 'Allotments',
          broadType: 'Urban'
        })
      ]
    }
    const baseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-grass', ref: 'B-A1' }),
        baselineHabitat({
          featureId: 'b-urban',
          type: 'Allotments',
          broadType: 'Urban'
        })
      ]
    }
    const postIntervention = {
      habitats: [
        postInterventionHabitat({ featureId: 'pi-grass' }),
        postInterventionHabitat({
          featureId: 'pi-urban',
          baseline: { type: 'Allotments', broadType: 'Urban' },
          proposed: { type: 'Allotments', broadType: 'Urban' }
        })
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline,
      previousBaseline
    })

    expect(postIntervention.habitats.map((h) => h.ref)).toEqual(['B-A1', 'A1'])
  })

  test('keeps the ref of a row that cannot be told apart, and says so', () => {
    const logger = { warn: vi.fn() }
    const previousBaseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-1' }),
        baselineHabitat({ featureId: 'b-2' })
      ]
    }
    const baseline = {
      habitats: [
        baselineHabitat({ featureId: 'b-1', ref: 'B-A1' }),
        baselineHabitat({ featureId: 'b-2' })
      ]
    }
    const postIntervention = { habitats: [postInterventionHabitat()] }

    resyncPostInterventionBaselineSide(
      postIntervention,
      { baseline, previousBaseline },
      logger
    )

    expect(postIntervention.habitats[0].ref).toBe('A1')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  test('renames a hedgerow row with its baseline hedgerow', () => {
    const baselineHedgerow = (ref) => ({
      featureId: 'b-h',
      ref,
      type: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: 1000
    })
    const postIntervention = {
      hedgerows: [makeHedgerow({ featureId: 'pi-h', ref: 'H1' })]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      baseline: { hedgerows: [baselineHedgerow('B-H1')] },
      previousBaseline: { hedgerows: [baselineHedgerow('H1')] }
    })

    expect(postIntervention.hedgerows[0].ref).toBe('B-H1')
  })
})

test.each(['habitats', 'trees', 'hedgerows', 'watercourses'])(
  'an untouched template Created %s row still follows a baseline reference rename',
  (layer) => {
    const parentFeatureId = 'baseline-1'
    const feature = {
      featureId: 'pi-1',
      ref: 'A1',
      retentionCategory: 'Created',
      parentFeatureId,
      baseline: { condition: 'Poor' },
      proposed: {}
    }
    const previousBaseline = {
      [layer]: [{ featureId: parentFeatureId, ref: 'A1', condition: 'Poor' }]
    }
    const baseline = {
      [layer]: [{ featureId: parentFeatureId, ref: 'A2', condition: 'Good' }]
    }
    resyncPostInterventionBaselineSide(
      { [layer]: [feature] },
      { baseline, previousBaseline }
    )
    expect(feature.ref).toBe('A2')
    expect(feature.baseline.condition).toBe('Good')
    expect(feature.referenceEdited).toBeUndefined()
  }
)
