import { describe, expect, test } from 'vitest'

import { watercourseTradingRuleStatuses } from './watercourse-trading-rule-statuses.js'

const MEDIUM_IN_DEFICIT = {
  habitats: [],
  medium: { surplus: 0, deficit: -4 },
  low: { netUnitChange: 2, cumulativeAvailability: 2 }
}

const LOW_IN_DEFICIT = {
  habitats: [],
  medium: { surplus: 4, deficit: 0 },
  low: { netUnitChange: -6, cumulativeAvailability: -2 }
}

const ALL_IN_SURPLUS = {
  habitats: [],
  medium: { surplus: 4, deficit: 0 },
  low: { netUnitChange: 2, cumulativeAvailability: 6 }
}

const withFigures = (watercourses) => ({
  watercourses: [{ type: 'Ditches' }],
  tradingRules: { watercourses }
})

const baselineWith = (...bands) => ({
  watercourses: bands.map((distinctiveness) => ({ distinctiveness }))
})

const NONE = { medium: null, low: null, overall: null }

describe('watercourseTradingRuleStatuses', () => {
  test('fails the Medium band when its deficit is below zero', () => {
    expect(
      watercourseTradingRuleStatuses(
        withFigures(MEDIUM_IN_DEFICIT),
        baselineWith('Medium', 'Low')
      )
    ).toEqual({ medium: 'Not met', low: 'Met', overall: 'Not met' })
  })

  test('fails the Low band when cumulative availability is below zero', () => {
    expect(
      watercourseTradingRuleStatuses(
        withFigures(LOW_IN_DEFICIT),
        baselineWith('Medium', 'Low')
      )
    ).toEqual({ medium: 'Met', low: 'Not met', overall: 'Not met' })
  })

  test('passes when neither band is in deficit', () => {
    expect(
      watercourseTradingRuleStatuses(
        withFigures(ALL_IN_SURPLUS),
        baselineWith('Medium')
      )
    ).toEqual({ medium: 'Met', low: 'Met', overall: 'Met' })
  })

  test('is null when the post-intervention file has watercourses and the baseline has none', () => {
    expect(
      watercourseTradingRuleStatuses(withFigures(ALL_IN_SURPLUS), {
        watercourses: []
      })
    ).toEqual(NONE)
  })

  test('is null when there are no watercourses in baseline or post-intervention', () => {
    // Every AC needs a baseline watercourse. With none, the rules do not apply
    // and there is nothing to display — a "Met" tile here would be a fiction.
    expect(
      watercourseTradingRuleStatuses(
        {
          watercourses: [],
          tradingRules: {
            watercourses: {
              habitats: [],
              medium: { surplus: 0, deficit: 0 },
              low: { netUnitChange: 0, cumulativeAvailability: 0 }
            }
          }
        },
        { watercourses: [] }
      )
    ).toEqual(NONE)
  })

  test('is Not met for the bands the baseline holds when no post-intervention file exists', () => {
    expect(
      watercourseTradingRuleStatuses(undefined, baselineWith('Medium', 'Low'))
    ).toEqual({ medium: 'Not met', low: 'Not met', overall: 'Not met' })

    expect(watercourseTradingRuleStatuses(null, baselineWith('Low'))).toEqual({
      medium: null,
      low: 'Not met',
      overall: 'Not met'
    })
  })

  test('has no verdict when the baseline has no watercourses and no post-intervention file', () => {
    expect(
      watercourseTradingRuleStatuses(undefined, { watercourses: [] })
    ).toEqual(NONE)
    expect(watercourseTradingRuleStatuses(null)).toEqual(NONE)
  })

  test.each([
    ['no trading rules at all', { watercourses: [{ type: 'Ditches' }] }],
    [
      'trading rules for another module only',
      { tradingRules: {}, watercourses: [{}] }
    ]
  ])('has no verdict for %s', (_label, postIntervention) => {
    expect(
      watercourseTradingRuleStatuses(postIntervention, baselineWith('Medium'))
    ).toEqual(NONE)
  })

  test('reads a watercourse count from a report site model', () => {
    expect(
      watercourseTradingRuleStatuses(null, {
        documentCounts: { watercourses: 1 }
      })
    ).toEqual({ medium: null, low: null, overall: 'Not met' })
  })
})
