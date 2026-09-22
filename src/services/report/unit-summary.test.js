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

  test('never calls area habitats post-intervention-only, even with no polygons', () => {
    // A baseline of one individual tree and no habitat polygons. `habitats` is
    // the whole area module, trees included, so a polygon count of zero does
    // NOT mean the site had no area habitats — and the screen never asks this
    // question of the area module at all. Raised in review on #297, where a
    // trees-only baseline had a 100% gain discarded as "Not applicable"
    // beside its own baseline of 1.00 units.
    const summary = summaryFor(
      'habitats',
      site({ habitatsTotal: 0, treesTotal: 1 }, { habitats: 0, trees: 1 }),
      site(
        {
          habitatsTotal: 2,
          treesTotal: 0,
          habitatsNetUnitChange: 1,
          habitatsNetUnitChangePercentage: 100
        },
        { habitats: 1, trees: 0 }
      )
    )

    expect(summary.netPercentageChange).toBe('100.00%')
    expect(summary.status).toEqual({ text: 'Met', met: true })
    // And the heading is the hyphenated one, because there IS a comparable
    // post-intervention file.
    expect(summary.postInterventionHeading).toBe('On-site post-intervention')
  })

  test('keeps the baseline and the verdict telling the same story', () => {
    // The invariant the bug broke: a tile that reports baseline units cannot
    // also claim there was no baseline to improve on.
    const summary = summaryFor(
      'habitats',
      site({ habitatsTotal: 0, treesTotal: 1 }, { habitats: 0, trees: 1 }),
      site(
        { habitatsTotal: 1, treesTotal: 0, habitatsNetUnitChangePercentage: 0 },
        { habitats: 1 }
      )
    )

    expect(summary.baselineUnits).toBe('1.00 units')
    expect(summary.netPercentageChange).not.toBe('Not applicable')
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

describe('the trading-rules status', () => {
  const FIGURES_MEDIUM_IN_DEFICIT = {
    habitatTypes: [],
    medium: {
      broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: -4 }],
      surplus: 0,
      deficit: -4
    },
    low: { netUnitChange: 2, cumulativeAvailability: 2 }
  }

  const FIGURES_ALL_IN_SURPLUS = {
    habitatTypes: [],
    medium: {
      broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: 4 }],
      surplus: 4,
      deficit: 0
    },
    low: { netUnitChange: 2, cumulativeAvailability: 6 }
  }

  const siteWithFigures = (areaHabitats) => ({
    ...site({ habitatsTotal: 18.5, habitatsNetUnitChangePercentage: 44.23 }),
    tradingRules: { areaHabitats }
  })

  test('is derived from the persisted figures, not judged here', () => {
    // A Medium broad habitat in deficit fails the band, and with it the site,
    // even though the Low band has units to spare.
    const summary = summaryFor(
      'habitats',
      site(BASELINE_UNITS),
      siteWithFigures(FIGURES_MEDIUM_IN_DEFICIT)
    )

    expect(summary.tradingRulesStatus).toEqual({ text: 'Not met', met: false })
  })

  test('is Met when no broad habitat is in deficit', () => {
    const summary = summaryFor(
      'habitats',
      site(BASELINE_UNITS),
      siteWithFigures(FIGURES_ALL_IN_SURPLUS)
    )

    expect(summary.tradingRulesStatus).toEqual({ text: 'Met', met: true })
  })

  test('can disagree with the net-gain verdict on the same section', () => {
    // A site can clear 10% net gain and still break the trading rules, by
    // replacing a habitat with units from the wrong broad habitat. The two
    // tiles answer different questions and must be free to differ.
    const summary = summaryFor(
      'habitats',
      site(BASELINE_UNITS),
      siteWithFigures(FIGURES_MEDIUM_IN_DEFICIT)
    )

    expect(summary.status.met).toBe(true)
    expect(summary.tradingRulesStatus.met).toBe(false)
  })

  test('is Not met when no post-intervention file was uploaded', () => {
    // Nothing has been delivered to trade against, so the rules cannot be met.
    const summary = summaryFor('habitats', site(BASELINE_UNITS), null)

    expect(summary.tradingRulesStatus).toEqual({ text: 'Not met', met: false })
  })

  test('has no verdict before the figures were calculated', () => {
    // A document written before the figures existed. An untagged tile says
    // nothing, where a red tag would claim the site was assessed and failed.
    const summary = summaryFor(
      'habitats',
      site(BASELINE_UNITS),
      site({ habitatsTotal: 18.5 })
    )

    expect(summary.tradingRulesStatus).toBeNull()
  })

  test('is not offered for hedgerows or watercourses yet', () => {
    const summaries = summariseUnitTypes(
      site(BASELINE_UNITS, { hedgerows: 1, watercourses: 1 }),
      siteWithFigures(FIGURES_MEDIUM_IN_DEFICIT)
    )

    for (const key of ['hedgerows', 'watercourses']) {
      expect(
        summaries.find((summary) => summary.key === key).tradingRulesStatus
      ).toBeNull()
    }
  })
})
