import { describe, expect, test } from 'vitest'

import { areaTradingRuleStatuses } from './area-trading-rule-statuses.js'

/** Lakes in deficit; the Low band has units to spare. */
const MEDIUM_IN_DEFICIT = {
  habitatTypes: [],
  medium: {
    broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: -4 }],
    surplus: 0,
    deficit: -4
  },
  low: { netUnitChange: 2, cumulativeAvailability: 2 }
}

const ALL_IN_SURPLUS = {
  habitatTypes: [],
  medium: {
    broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: 4 }],
    surplus: 4,
    deficit: 0
  },
  low: { netUnitChange: 2, cumulativeAvailability: 6 }
}

const withFigures = (areaHabitats) => ({ tradingRules: { areaHabitats } })

describe('areaTradingRuleStatuses', () => {
  test('fails the site when a Medium broad habitat is in deficit', () => {
    // The Low band passes on its own figure, and the site still fails. That
    // pairing is the whole point of deriving in one place: applying the Low
    // rule alone would report this site compliant.
    expect(areaTradingRuleStatuses(withFigures(MEDIUM_IN_DEFICIT))).toEqual({
      medium: 'Not met',
      low: 'Met',
      overall: 'Not met'
    })
  })

  test('passes the site when nothing is in deficit', () => {
    expect(areaTradingRuleStatuses(withFigures(ALL_IN_SURPLUS))).toEqual({
      medium: 'Met',
      low: 'Met',
      overall: 'Met'
    })
  })

  test('is Not met with no post-intervention document', () => {
    // Nothing has been delivered to trade against. Neither band is derived,
    // because each rule needs both files.
    const expected = { medium: null, low: null, overall: 'Not met' }

    expect(areaTradingRuleStatuses(undefined)).toEqual(expected)
    expect(areaTradingRuleStatuses(null)).toEqual(expected)
  })

  test.each([
    ['no trading rules at all', {}],
    ['trading rules for another module only', { tradingRules: {} }],
    ['an area-habitats key that is absent', { tradingRules: { hedgerows: {} } }]
  ])('has no verdict for %s', (_label, postIntervention) => {
    // A file was uploaded but the figures were never calculated. Unknown is
    // not failed: a red "Not met" here would claim the site was assessed.
    expect(areaTradingRuleStatuses(postIntervention)).toEqual({
      medium: null,
      low: null,
      overall: null
    })
  })

  test('does not hand back a shared object callers could mutate', () => {
    const first = areaTradingRuleStatuses({})
    first.overall = 'Met'

    expect(areaTradingRuleStatuses({}).overall).toBeNull()
  })
})
