/**
 * The summary figures, and the wording rules around them.
 *
 * These rules exist twice — here and in the frontend's
 * `common/helpers/unit-summary.js` — so the report's first page and the
 * screen it mirrors agree. Every test below pins one of the rules that copy
 * depends on, so a drift between them fails here rather than showing up as
 * two different numbers in front of a user.
 */

import { describe, expect, test } from 'vitest'

import {
  NET_GAIN_TARGET_PERCENTAGE,
  areaUnits,
  formatUnits,
  percentageSummary,
  summariseUnitTypes
} from './unit-summary.js'

function site(units, counts = {}) {
  return {
    units,
    documentCounts: { habitats: 1, hedgerows: 0, watercourses: 0, ...counts }
  }
}

const BASELINE_UNITS = {
  habitatsTotal: 12.5,
  treesTotal: 0.5,
  hedgerowsTotal: 2,
  watercoursesTotal: 1
}

function summaryFor(key, baseline, postIntervention) {
  return summariseUnitTypes(baseline, postIntervention).find(
    (summary) => summary.key === key
  )
}

describe('#formatUnits', () => {
  test('rounds to two places', () => {
    expect(formatUnits(3.14159)).toBe('3.14')
    // Unit totals are sums of floating-point products, so a figure meant to
    // be exactly 10 arrives a hair under it.
    expect(formatUnits(9.999999999999998)).toBe('10.00')
  })

  test('writes a negative zero as zero', () => {
    // A net change of nothing is not a loss, and "-0.00 units" reads as one.
    expect(formatUnits(-0.001)).toBe('0.00')
  })

  test('treats anything that is not a number as zero', () => {
    expect(formatUnits(undefined)).toBe('0.00')
    expect(formatUnits(Number.NaN)).toBe('0.00')
  })
})

describe('#areaUnits', () => {
  test('counts individual trees inside area habitats', () => {
    // The metric treats them as one module, even though the totals are
    // stored separately.
    expect(areaUnits({ habitatsTotal: 12.5, treesTotal: 0.5 })).toBe(13)
  })

  test('reports the missing value only when neither total exists', () => {
    expect(areaUnits({ treesTotal: 0.5 }, null)).toBe(0.5)
    expect(areaUnits({}, null)).toBeNull()
  })
})

describe('#percentageSummary', () => {
  test('judges the target on the rounded percentage, not the raw one', () => {
    const summary = percentageSummary(9.999999999999998)

    // Raw, that is under 10 and not met. The tile would then read "10.00%"
    // beside a red "Not met", which looks like a bug whichever way round it
    // is decided — so the displayed figure is the one judged.
    expect(summary.netPercentageChange).toBe('10.00%')
    expect(summary.status).toEqual({ text: 'Met', met: true })
  })

  test('is not met just below the target', () => {
    expect(percentageSummary(NET_GAIN_TARGET_PERCENTAGE - 0.01).status).toEqual(
      { text: 'Not met', met: false }
    )
  })

  test('gives no verdict where there is nothing to judge', () => {
    // An unassessable change is not an assessed failure, and a red "Not met"
    // beside "N/A" would say it was.
    expect(percentageSummary(null)).toEqual({
      netPercentageChange: 'N/A',
      status: null
    })
  })
})

describe('#summariseUnitTypes', () => {
  test('reads the engine figures off the document rather than recomputing', () => {
    const summary = summaryFor(
      'habitats',
      site(BASELINE_UNITS),
      site({
        habitatsTotal: 18.5,
        treesTotal: 0.5,
        // Deliberately not what 19 - 13 comes to: whatever the engine wrote
        // is what the report shows, because the screen shows it too.
        habitatsNetUnitChange: 5.75,
        habitatsNetUnitChangePercentage: 44.23
      })
    )

    expect(summary.netPercentageChange).toBe('44.23%')
    expect(summary.netUnitChange).toBe('5.75 units')
    expect(summary.baselineUnits).toBe('13.00 units')
    expect(summary.postInterventionUnits).toBe('19.00 units')
    expect(summary.status.met).toBe(true)
  })

  test('reports a baseline with no post-intervention as losing everything', () => {
    const summary = summaryFor('habitats', site(BASELINE_UNITS), null)

    // Not "unknown": every unit on the site goes and nothing replaces it,
    // which is what the summary screen says too.
    expect(summary.netPercentageChange).toBe('-100.00%')
    expect(summary.netUnitChange).toBe('-13.00 units')
    expect(summary.postInterventionUnits).toBe('0.00 units')
    expect(summary.status).toEqual({ text: 'Not met', met: false })
  })

  test('has no percentage to give when the baseline is zero', () => {
    const summary = summaryFor('habitats', site({ habitatsTotal: 0 }), null)

    expect(summary.netPercentageChange).toBe('N/A')
    expect(summary.status).toBeNull()
  })

  test('calls a habitat type that only appears afterwards not applicable', () => {
    const summary = summaryFor(
      'hedgerows',
      site({ hedgerowsTotal: 0 }, { hedgerows: 0 }),
      site({ hedgerowsTotal: 4 }, { hedgerows: 3 })
    )

    // There is no baseline to improve on, so a percentage change of any value
    // would be a fiction.
    expect(summary.netPercentageChange).toBe('Not applicable')
    expect(summary.status).toBeNull()
    expect(summary.postInterventionHeading).toBe('On-site post intervention')
  })

  test('shows a linear type only where the project holds features of it', () => {
    const withHedges = summariseUnitTypes(
      site(BASELINE_UNITS, { hedgerows: 2 }),
      null
    )
    const withoutHedges = summariseUnitTypes(site(BASELINE_UNITS), null)

    // Three tiles of zeroes on a site with no hedges would say nothing, which
    // is why the screen hides the section rather than showing it empty.
    expect(withHedges.map(({ key }) => key)).toEqual(['habitats', 'hedgerows'])
    expect(withoutHedges.map(({ key }) => key)).toEqual(['habitats'])
  })

  test('always shows area habitats, even on a project with none recorded', () => {
    const summaries = summariseUnitTypes(site({}, { habitats: 0 }), null)

    expect(summaries.map(({ key }) => key)).toEqual(['habitats'])
    expect(summaries[0].baselineUnits).toBe('0.00 units')
  })
})
