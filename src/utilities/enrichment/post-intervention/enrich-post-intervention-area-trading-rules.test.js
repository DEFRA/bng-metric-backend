import { describe, expect, test, vi } from 'vitest'

import { enrichPostInterventionAreaTradingRules } from './enrich-post-intervention-area-trading-rules.js'

const NEUTRAL_GRASSLAND = 'Other neutral grassland' // Grassland, Medium
const MODIFIED_GRASSLAND = 'Modified grassland' // Grassland, Low
const RESERVOIRS = 'Reservoirs' // Lakes, Medium
const ALLOTMENTS = 'Allotments' // Urban, Low
const SEALED_SURFACE = 'Developed land; sealed surface' // Urban, V.Low

/**
 * @param {object} overrides
 * @returns {object} a post-intervention area feature
 */
function piFeature({
  featureId = 'feature-1',
  retentionCategory = 'Created',
  baselineBroad = null,
  baselineType = null,
  proposedBroad = null,
  proposedType = null,
  units = 0
}) {
  return {
    featureId,
    retentionCategory,
    units,
    baseline: { broadType: baselineBroad, type: baselineType },
    proposed: { broadType: proposedBroad, type: proposedType }
  }
}

describe('enrichPostInterventionAreaTradingRules', () => {
  test('nets delivered units against the stored baseline units', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          retentionCategory: 'Retained',
          baselineBroad: 'Lakes',
          baselineType: RESERVOIRS,
          units: 6
        })
      ]
    }
    const baseline = {
      habitats: [{ broadType: 'Lakes', type: RESERVOIRS, units: 10 }]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, baseline)

    expect(postIntervention.tradingRules.areaHabitats.habitats).toEqual([
      {
        habitatType: 'Lakes - Reservoirs',
        broadHabitat: 'Lakes',
        tradingBroadHabitat: 'Lakes',
        distinctiveness: 'Medium',
        netUnitChange: -4
      }
    ])
  })

  test('attributes an Enhanced feature to the proposed habitat, not the baseline', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          retentionCategory: 'Enhanced',
          baselineBroad: 'Grassland',
          baselineType: MODIFIED_GRASSLAND,
          proposedBroad: 'Grassland',
          proposedType: NEUTRAL_GRASSLAND,
          units: 9
        })
      ]
    }
    const baseline = {
      habitats: [{ broadType: 'Grassland', type: MODIFIED_GRASSLAND, units: 4 }]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, baseline)

    const { habitats } = postIntervention.tradingRules.areaHabitats
    expect(habitats).toEqual([
      {
        habitatType: 'Grassland - Modified grassland',
        broadHabitat: 'Grassland',
        tradingBroadHabitat: 'Grassland',
        distinctiveness: 'Low',
        netUnitChange: -4
      },
      {
        habitatType: 'Grassland - Other neutral grassland',
        broadHabitat: 'Grassland',
        tradingBroadHabitat: 'Grassland',
        distinctiveness: 'Medium',
        netUnitChange: 9
      }
    ])
  })

  test('attributes a Retained feature to its baseline habitat', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          retentionCategory: 'Retained',
          baselineBroad: 'Lakes',
          baselineType: RESERVOIRS,
          // A retained parcel's proposed columns can be an "N/A" placeholder.
          proposedBroad: 'Urban',
          proposedType: ALLOTMENTS,
          units: 3
        })
      ]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(
      postIntervention.tradingRules.areaHabitats.habitats.map(
        (habitat) => habitat.habitatType
      )
    ).toEqual(['Lakes - Reservoirs'])
  })

  test('counts a Lost baseline parcel, which is persisted as Created', () => {
    // The GeoPackage said Lost; the parcel is stored as Created with a new
    // proposed habitat. Its baseline units only exist on the baseline document.
    const postIntervention = {
      habitats: [
        piFeature({
          retentionCategory: 'Created',
          baselineBroad: 'Lakes',
          baselineType: RESERVOIRS,
          proposedBroad: 'Urban',
          proposedType: ALLOTMENTS,
          units: 2
        })
      ]
    }
    const baseline = {
      habitats: [{ broadType: 'Lakes', type: RESERVOIRS, units: 7 }]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, baseline)

    const { areaHabitats } = postIntervention.tradingRules
    expect(areaHabitats.medium.broadHabitats).toEqual([
      { broadHabitat: 'Lakes', netUnitChange: -7 }
    ])
    expect(areaHabitats.low.netChange).toBe(2)
  })

  test('aggregates individual trees alongside habitat parcels', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          proposedBroad: 'Lakes',
          proposedType: RESERVOIRS,
          units: 5
        })
      ],
      trees: [
        piFeature({
          featureId: 'tree-1',
          proposedBroad: 'Individual trees',
          proposedType: 'Urban tree',
          units: 2
        })
      ]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(
      postIntervention.tradingRules.areaHabitats.medium.broadHabitats
    ).toEqual([
      { broadHabitat: 'Individual trees', netUnitChange: 2 },
      { broadHabitat: 'Lakes', netUnitChange: 5 }
    ])
  })

  test('sums several features of the same habitat type into one entry', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          featureId: 'a',
          proposedBroad: 'Lakes',
          proposedType: RESERVOIRS,
          units: 4
        }),
        piFeature({
          featureId: 'b',
          proposedBroad: 'Lakes',
          proposedType: RESERVOIRS,
          units: 1.5
        })
      ]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(postIntervention.tradingRules.areaHabitats.habitats).toEqual([
      {
        habitatType: 'Lakes - Reservoirs',
        broadHabitat: 'Lakes',
        tradingBroadHabitat: 'Lakes',
        distinctiveness: 'Medium',
        netUnitChange: 5.5
      }
    ])
  })

  test('accepts a habitat type that already carries its broad-habitat prefix', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          proposedBroad: null,
          proposedType: 'Lakes - Reservoirs',
          units: 3
        })
      ]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(
      postIntervention.tradingRules.areaHabitats.habitats[0].habitatType
    ).toBe('Lakes - Reservoirs')
  })

  test('skips an Incomplete feature whose units were never calculated', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          proposedBroad: 'Lakes',
          proposedType: RESERVOIRS,
          units: null
        })
      ]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(postIntervention.tradingRules.areaHabitats.habitats).toEqual([])
    expect(postIntervention.tradingRules.areaHabitats.cumulativeSurplus).toBe(0)
  })

  test('warns and excludes a habitat type the reference data does not know', () => {
    const logger = { warn: vi.fn() }
    const postIntervention = {
      habitats: [
        piFeature({
          featureId: 'odd-one',
          proposedBroad: 'Lakes',
          proposedType: 'Not a real habitat',
          units: 5
        })
      ]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {}, logger)

    expect(postIntervention.tradingRules.areaHabitats.habitats).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('odd-one'))
  })

  test('excludes Very Low habitats, which hold no units to trade', () => {
    const postIntervention = {
      habitats: [
        piFeature({
          proposedBroad: 'Urban',
          proposedType: SEALED_SURFACE,
          units: 0
        })
      ]
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(postIntervention.tradingRules.areaHabitats.habitats).toEqual([])
  })

  test('preserves trading-rules figures already written by another module', () => {
    const postIntervention = {
      habitats: [],
      tradingRules: { watercourses: { low: { netChange: 1 } } }
    }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(postIntervention.tradingRules.watercourses).toEqual({
      low: { netChange: 1 }
    })
    expect(postIntervention.tradingRules.areaHabitats).toBeDefined()
  })

  test('writes zeroed figures for a project with no area habitats', () => {
    const postIntervention = { hedgerows: [{ units: 4 }] }

    enrichPostInterventionAreaTradingRules(postIntervention, {})

    expect(postIntervention.tradingRules.areaHabitats).toEqual({
      habitats: [],
      medium: { broadHabitats: [], surplus: 0, deficit: 0 },
      low: { netChange: 0 },
      cumulativeSurplus: 0
    })
  })
})
