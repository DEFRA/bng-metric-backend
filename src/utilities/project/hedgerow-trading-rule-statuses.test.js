import { describe, expect, test } from 'vitest'

import { hedgerowTradingRuleStatuses } from './hedgerow-trading-rule-statuses.js'
import { enrichPostInterventionHedgerowTradingRules } from '../enrichment/post-intervention/enrich-post-intervention-hedgerow-trading-rules.js'

const SPECIES_RICH = 'Species-rich native hedgerow' // Medium
const NATIVE_BANK = 'Native hedgerow - associated with bank or ditch' // Medium
const NATIVE_TREES = 'Native hedgerow with trees' // Medium
const NATIVE = 'Native hedgerow' // Low
const LINE_OF_TREES = 'Line of trees' // Low
const LINE_OF_TREES_BANK = 'Line of trees - associated with bank or ditch' // Low
const NON_NATIVE = 'Non-native and ornamental hedgerow' // V.Low

const NONE = { medium: null, low: null, veryLow: null, overall: null }

const habitatType = (type, distinctiveness, netUnitChange) => ({
  habitatType: type,
  distinctiveness,
  netUnitChange
})

/**
 * Figures in the shape BMD-994 persists, with one habitat type per band so
 * every band applies.
 */
function figures({ medium = 1, lowCumulative = 1, veryLowCumulative = 1 }) {
  return {
    habitatTypes: [
      habitatType(SPECIES_RICH, 'Medium', medium),
      habitatType(NATIVE, 'Low', 0),
      habitatType(NON_NATIVE, 'V.Low', 0)
    ],
    medium: { netUnitChange: medium },
    low: { netUnitChange: 0, cumulativeAvailability: lowCumulative },
    veryLow: { netUnitChange: 0, cumulativeAvailability: veryLowCumulative }
  }
}

const withFigures = (hedgerows) => ({
  hedgerows: [{ type: NATIVE }],
  tradingRules: { hedgerows }
})

const baselineWith = (...types) => ({
  hedgerows: types.map((type) => ({ type }))
})

const EVERY_BAND = baselineWith(SPECIES_RICH, NATIVE, NON_NATIVE)

describe('hedgerowTradingRuleStatuses', () => {
  describe('AC1 — the Medium band', () => {
    test('is Not met when the Medium net unit change is below zero', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ medium: -0.01 })),
          EVERY_BAND
        ).medium
      ).toBe('Not met')
    })

    test('is Met at exactly zero, which is not a deficit', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ medium: 0 })),
          EVERY_BAND
        ).medium
      ).toBe('Met')
    })

    test('applies where a Medium hedgerow is only on the post-intervention side', () => {
      // AC1 asks for a Medium hedgerow habitat, not a baseline one: one
      // created from nothing still has a band to report.
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ medium: 0.5 })),
          baselineWith(NATIVE)
        ).medium
      ).toBe('Met')
    })

    test('is not derived where no Medium hedgerow type appears on either side', () => {
      const lowOnly = {
        habitatTypes: [habitatType(NATIVE, 'Low', 1)],
        medium: { netUnitChange: 0 },
        low: { netUnitChange: 1, cumulativeAvailability: 1 },
        veryLow: { netUnitChange: 0, cumulativeAvailability: 1 }
      }

      expect(
        hedgerowTradingRuleStatuses(withFigures(lowOnly), baselineWith(NATIVE))
      ).toEqual({ medium: null, low: 'Met', veryLow: null, overall: 'Met' })
    })
  })

  describe('AC2 — the Low band', () => {
    test('is Not met when Low cumulative availability is below zero', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ lowCumulative: -0.5 })),
          EVERY_BAND
        ).low
      ).toBe('Not met')
    })

    test('is Met when Low cumulative availability is zero or more', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ lowCumulative: 0 })),
          EVERY_BAND
        ).low
      ).toBe('Met')
    })

    test('is not derived where the baseline has no Low hedgerow', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({})),
          baselineWith(SPECIES_RICH, NON_NATIVE)
        ).low
      ).toBeNull()
    })
  })

  describe('AC3 — the Very Low band', () => {
    test('is Not met when Very Low cumulative availability is below zero', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ veryLowCumulative: -0.35 })),
          EVERY_BAND
        ).veryLow
      ).toBe('Not met')
    })

    test('is Met when Very Low cumulative availability is zero or more', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ veryLowCumulative: 0 })),
          EVERY_BAND
        ).veryLow
      ).toBe('Met')
    })

    test('is not derived where the baseline has no Very Low hedgerow', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({})),
          baselineWith(SPECIES_RICH, NATIVE)
        ).veryLow
      ).toBeNull()
    })
  })

  describe('AC4 — the hedgerow unit type', () => {
    test('is Met when no band is Not met', () => {
      expect(
        hedgerowTradingRuleStatuses(withFigures(figures({})), EVERY_BAND)
      ).toEqual({ medium: 'Met', low: 'Met', veryLow: 'Met', overall: 'Met' })
    })

    test.each([
      ['Medium', { medium: -1 }],
      ['Low', { lowCumulative: -1 }],
      ['Very Low', { veryLowCumulative: -1 }]
    ])('is Not met when the %s band is', (_band, overrides) => {
      expect(
        hedgerowTradingRuleStatuses(withFigures(figures(overrides)), EVERY_BAND)
          .overall
      ).toBe('Not met')
    })

    test('still fails on a band it does not report, when the baseline bands are unknown', () => {
      // A report site model carries a count of hedgerows, not their bands.
      // Skipping the Low rule there would report Met for a site in deficit.
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ lowCumulative: -2 })),
          { documentCounts: { hedgerows: 3 } }
        )
      ).toEqual({ medium: 'Met', low: null, veryLow: null, overall: 'Not met' })
    })

    test('reads the band enrichment stored on a baseline hedgerow', () => {
      expect(
        hedgerowTradingRuleStatuses(
          withFigures(figures({ veryLowCumulative: -1 })),
          { hedgerows: [{ type: 'Unrecognised', distinctiveness: 'V.Low' }] }
        ).veryLow
      ).toBe('Not met')
    })
  })

  describe('AC5 — hedgerows after intervention but none on the baseline', () => {
    test('has no verdict: trading rules do not apply', () => {
      expect(
        hedgerowTradingRuleStatuses(withFigures(figures({ medium: 3 })), {
          hedgerows: []
        })
      ).toEqual(NONE)
    })

    test('has no verdict when neither side has hedgerows', () => {
      expect(
        hedgerowTradingRuleStatuses(
          {
            hedgerows: [],
            tradingRules: {
              hedgerows: {
                habitatTypes: [],
                medium: { netUnitChange: 0 },
                low: { netUnitChange: 0, cumulativeAvailability: 0 },
                veryLow: { netUnitChange: 0, cumulativeAvailability: 0 }
              }
            }
          },
          { hedgerows: [] }
        )
      ).toEqual(NONE)
    })
  })

  describe('AC6 — hedgerows on the baseline but no post-intervention file', () => {
    test('is Not met overall, with no band derived', () => {
      // Nothing has been delivered to trade against. Each band rule needs both
      // files, so no band is reported.
      expect(hedgerowTradingRuleStatuses(undefined, EVERY_BAND)).toEqual({
        medium: null,
        low: null,
        veryLow: null,
        overall: 'Not met'
      })
      expect(
        hedgerowTradingRuleStatuses(null, baselineWith(NATIVE)).overall
      ).toBe('Not met')
    })

    test('reads a hedgerow count from a report site model', () => {
      expect(
        hedgerowTradingRuleStatuses(null, { documentCounts: { hedgerows: 1 } })
      ).toEqual({ medium: null, low: null, veryLow: null, overall: 'Not met' })
    })

    test('has no verdict when the baseline has no hedgerows either', () => {
      expect(hedgerowTradingRuleStatuses(undefined, { hedgerows: [] })).toEqual(
        NONE
      )
      expect(hedgerowTradingRuleStatuses(null)).toEqual(NONE)
    })
  })

  test.each([
    ['no trading rules at all', { hedgerows: [{ type: NATIVE }] }],
    [
      'trading rules for another module only',
      { tradingRules: { watercourses: {} } }
    ]
  ])('has no verdict for %s', (_label, postIntervention) => {
    expect(hedgerowTradingRuleStatuses(postIntervention, EVERY_BAND)).toEqual(
      NONE
    )
  })

  test('reproduces the hedgerow worked example', () => {
    // "Example - Hedgerows MVS.xlsx", Trading Summary Hedgerows: Medium nets
    // +0.4145 (Met), Low cumulative availability is -2.1327 (Not met), Very
    // Low cumulative availability is -0.35 (Not met), so the site is Not met.
    const piHedgerow = (
      retentionCategory,
      baselineType,
      proposedType,
      units
    ) => ({
      retentionCategory,
      units,
      baseline: { type: baselineType },
      proposed: { type: proposedType }
    })
    const postIntervention = {
      hedgerows: [
        piHedgerow('Retained', NATIVE_BANK, null, 2.2),
        piHedgerow('Retained', NATIVE, null, 0.22000000000000003),
        piHedgerow('Retained', LINE_OF_TREES_BANK, null, 0.1),
        piHedgerow('Retained', NON_NATIVE, null, 0.05),
        piHedgerow('Created', null, NATIVE_BANK, 0.5602258193599999),
        piHedgerow('Created', null, NATIVE_TREES, 0.8),
        piHedgerow('Created', null, LINE_OF_TREES, 0.16415073244),
        piHedgerow('Created', null, NON_NATIVE, 0.1),
        piHedgerow('Enhanced', NATIVE_BANK, NATIVE_BANK, 2.931225),
        piHedgerow('Enhanced', NATIVE, SPECIES_RICH, 0.5230158784400001),
        piHedgerow(
          'Enhanced',
          LINE_OF_TREES_BANK,
          LINE_OF_TREES_BANK,
          0.16868302208000002
        )
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

    expect(hedgerowTradingRuleStatuses(postIntervention, baseline)).toEqual({
      medium: 'Met',
      low: 'Not met',
      veryLow: 'Not met',
      overall: 'Not met'
    })
  })
})
