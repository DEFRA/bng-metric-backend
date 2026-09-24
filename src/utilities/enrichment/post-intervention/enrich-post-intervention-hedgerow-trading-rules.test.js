import { describe, expect, test, vi } from 'vitest'

import { enrichPostInterventionHedgerowTradingRules } from './enrich-post-intervention-hedgerow-trading-rules.js'
import { tradingRulesSchema } from '../../../validation/post-intervention/project-post-intervention-schema.js'

const SPECIES_RICH = 'Species-rich native hedgerow' // Medium
const NATIVE_BANK = 'Native hedgerow - associated with bank or ditch' // Medium
const NATIVE_TREES = 'Native hedgerow with trees' // Medium
const NATIVE = 'Native hedgerow' // Low
const LINE_OF_TREES = 'Line of trees' // Low
const LINE_OF_TREES_BANK = 'Line of trees - associated with bank or ditch' // Low
const NON_NATIVE = 'Non-native and ornamental hedgerow' // V.Low

/**
 * @param {object} overrides
 * @returns {object} a post-intervention hedgerow feature
 */
function piHedgerow({
  featureId = 'hedge-1',
  retentionCategory = 'Created',
  baselineType = null,
  proposedType = null,
  units = 0
}) {
  return {
    featureId,
    retentionCategory,
    units,
    baseline: { type: baselineType },
    proposed: { type: proposedType }
  }
}

describe('enrichPostInterventionHedgerowTradingRules', () => {
  test('nets delivered units against the stored baseline units', () => {
    const postIntervention = {
      hedgerows: [
        piHedgerow({
          retentionCategory: 'Retained',
          baselineType: NATIVE,
          units: 0.5
        })
      ]
    }
    const baseline = { hedgerows: [{ type: NATIVE, units: 2 }] }

    enrichPostInterventionHedgerowTradingRules(postIntervention, baseline)

    expect(postIntervention.tradingRules.hedgerows).toEqual({
      habitatTypes: [
        { habitatType: NATIVE, distinctiveness: 'Low', netUnitChange: -1.5 }
      ],
      medium: { netUnitChange: 0 },
      low: { netUnitChange: -1.5, cumulativeAvailability: -1.5 },
      veryLow: { netUnitChange: 0, cumulativeAvailability: 0 }
    })
  })

  test('attributes a retained hedgerow to its baseline type, even when proposed says otherwise', () => {
    const postIntervention = {
      hedgerows: [
        piHedgerow({
          retentionCategory: 'Retained',
          baselineType: NATIVE,
          proposedType: 'N/A',
          units: 1
        })
      ]
    }

    enrichPostInterventionHedgerowTradingRules(postIntervention, {
      hedgerows: [{ type: NATIVE, units: 1 }]
    })

    expect(postIntervention.tradingRules.hedgerows.habitatTypes).toEqual([
      { habitatType: NATIVE, distinctiveness: 'Low', netUnitChange: 0 }
    ])
  })

  test('attributes an enhanced hedgerow to its proposed type, moving units across bands', () => {
    const postIntervention = {
      hedgerows: [
        piHedgerow({
          retentionCategory: 'Enhanced',
          baselineType: NATIVE,
          proposedType: SPECIES_RICH,
          units: 1.5
        })
      ]
    }

    enrichPostInterventionHedgerowTradingRules(postIntervention, {
      hedgerows: [{ type: NATIVE, units: 2.2 }]
    })

    const { hedgerows } = postIntervention.tradingRules
    expect(hedgerows.medium.netUnitChange).toBe(1.5)
    expect(hedgerows.low.netUnitChange).toBe(-2.2)
    expect(hedgerows.low.cumulativeAvailability).toBeCloseTo(-0.7, 12)
  })

  test('counts a hedgerow lost entirely from the stored baseline', () => {
    // Lost hedgerows are excluded from the post-intervention feature set at
    // extract time; only the baseline still knows about them.
    const postIntervention = { hedgerows: [] }

    enrichPostInterventionHedgerowTradingRules(postIntervention, {
      hedgerows: [{ type: NON_NATIVE, units: 0.5 }]
    })

    expect(postIntervention.tradingRules.hedgerows.veryLow).toEqual({
      netUnitChange: -0.5,
      cumulativeAvailability: -0.5
    })
  })

  test('skips features with no finite units without poisoning the totals', () => {
    const postIntervention = {
      hedgerows: [
        piHedgerow({ proposedType: NATIVE, units: null }),
        piHedgerow({ proposedType: NATIVE, units: Number.NaN }),
        piHedgerow({ proposedType: NATIVE, units: 0.4 })
      ]
    }

    enrichPostInterventionHedgerowTradingRules(postIntervention, {
      hedgerows: [{ type: NATIVE, units: undefined }]
    })

    expect(postIntervention.tradingRules.hedgerows.low.netUnitChange).toBe(0.4)
  })

  test('skips a legacy stored hedgerow whose baseline still says Lost', () => {
    const legacyLost = {
      featureId: 'legacy',
      units: 0,
      baseline: { type: NATIVE, retentionCategory: 'Lost' },
      proposed: { type: LINE_OF_TREES }
    }
    const postIntervention = { hedgerows: [legacyLost] }

    enrichPostInterventionHedgerowTradingRules(postIntervention, {
      hedgerows: [{ type: NATIVE, units: 1 }]
    })

    expect(
      postIntervention.tradingRules.hedgerows.habitatTypes.map(
        (habitat) => habitat.habitatType
      )
    ).toEqual([NATIVE])
  })

  test('warns on, and excludes, a type the reference data does not know', () => {
    const logger = { warn: vi.fn() }
    const postIntervention = {
      hedgerows: [
        piHedgerow({ featureId: 'h-9', proposedType: 'Privet', units: 1 }),
        piHedgerow({ proposedType: { odd: true }, units: 1 }),
        piHedgerow({ proposedType: NATIVE_TREES, units: 0.8 })
      ]
    }

    enrichPostInterventionHedgerowTradingRules(postIntervention, {}, logger)

    expect(postIntervention.tradingRules.hedgerows.habitatTypes).toEqual([
      {
        habitatType: NATIVE_TREES,
        distinctiveness: 'Medium',
        netUnitChange: 0.8
      }
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      "enrichHedgerowTradingRules: featureId h-9: hedgerow type 'Privet' is not in the reference data, excluded from trading rules"
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('hedgerow type \'{"odd":true}\'')
    )
  })

  test('keeps the other modules already under tradingRules', () => {
    const areaHabitats = { habitatTypes: [] }
    const watercourses = { habitats: [] }
    const postIntervention = { tradingRules: { areaHabitats, watercourses } }

    enrichPostInterventionHedgerowTradingRules(postIntervention)

    expect(postIntervention.tradingRules.areaHabitats).toBe(areaHabitats)
    expect(postIntervention.tradingRules.watercourses).toBe(watercourses)
    expect(postIntervention.tradingRules.hedgerows.habitatTypes).toEqual([])
  })

  test('tolerates a document with no hedgerow arrays at all', () => {
    const postIntervention = { hedgerows: 'not an array' }

    enrichPostInterventionHedgerowTradingRules(postIntervention, {
      hedgerows: null
    })

    expect(postIntervention.tradingRules.hedgerows.habitatTypes).toEqual([])
  })

  test('reproduces the hedgerow worked example and persists only schema-declared fields', () => {
    // "Example - Hedgerows MVS.xlsx": 5 baseline hedgerows, 4 created, 3
    // enhanced (one Low -> Medium), one feature per workbook row.
    const postIntervention = {
      hedgerows: [
        piHedgerow({
          retentionCategory: 'Retained',
          baselineType: NATIVE_BANK,
          units: 2.2
        }),
        piHedgerow({
          retentionCategory: 'Retained',
          baselineType: NATIVE,
          units: 0.22000000000000003
        }),
        piHedgerow({
          retentionCategory: 'Retained',
          baselineType: LINE_OF_TREES_BANK,
          units: 0.1
        }),
        piHedgerow({
          retentionCategory: 'Retained',
          baselineType: NON_NATIVE,
          units: 0.05
        }),
        piHedgerow({ proposedType: NATIVE_BANK, units: 0.5602258193599999 }),
        piHedgerow({ proposedType: NATIVE_TREES, units: 0.8 }),
        piHedgerow({ proposedType: LINE_OF_TREES, units: 0.16415073244 }),
        piHedgerow({ proposedType: NON_NATIVE, units: 0.1 }),
        piHedgerow({
          retentionCategory: 'Enhanced',
          baselineType: NATIVE_BANK,
          proposedType: NATIVE_BANK,
          units: 2.931225
        }),
        piHedgerow({
          retentionCategory: 'Enhanced',
          baselineType: NATIVE,
          proposedType: SPECIES_RICH,
          units: 0.5230158784400001
        }),
        piHedgerow({
          retentionCategory: 'Enhanced',
          baselineType: LINE_OF_TREES_BANK,
          proposedType: LINE_OF_TREES_BANK,
          units: 0.16868302208000002
        })
      ]
    }
    const baseline = {
      hedgerows: [
        { type: NATIVE_BANK, units: 4.4 },
        { type: SPECIES_RICH, units: 2.2 },
        { type: NATIVE, units: 2.2 },
        { type: LINE_OF_TREES_BANK, units: 1 },
        { type: NON_NATIVE, units: 0.5 }
      ]
    }

    enrichPostInterventionHedgerowTradingRules(postIntervention, baseline)

    const { hedgerows } = postIntervention.tradingRules
    expect(hedgerows.medium.netUnitChange).toBeCloseTo(0.4144666978, 10)
    expect(hedgerows.low.netUnitChange).toBeCloseTo(-2.54716624548, 10)
    expect(hedgerows.low.cumulativeAvailability).toBeCloseTo(-2.13269954768, 10)
    expect(hedgerows.veryLow).toEqual({
      netUnitChange: -0.35,
      cumulativeAvailability: -0.35
    })

    const { error } = tradingRulesSchema.validate(postIntervention.tradingRules)
    expect(error).toBeUndefined()
  })
})
