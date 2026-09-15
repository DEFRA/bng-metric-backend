import { describe, expect, it } from 'vitest'

import {
  calculateCumulativeAvailability,
  calculateHabitatNetUnitChanges,
  calculateWatercourseTradingRules,
  resolveWatercourseDistinctiveness,
  sumDeficit,
  sumNetChange,
  sumSurplus
} from './trading-rules.js'
import { BaselineLookupError } from './errors.js'

// Delivered = retained + created + enhanced units per proposed habitat type;
// baseline = baseline units per habitat type. These are the worked-example
// aggregates (2 dp) from the BMD-995 spreadsheet.
//   Ditches (Medium): 15.52 + 10.87 + 14.66 = 41.05 delivered, 28.13 baseline
//   Canals  (Medium):  9.60 +  0.00 +  9.08 = 18.68 delivered, 24.86 baseline
//   Culvert (Low):     0.95 +  0.00 +  0.00 =  0.95 delivered, 22.44 baseline
const WORKED_EXAMPLE_BASELINE_BY_TYPE = {
  Ditches: 28.13,
  Canals: 24.86,
  Culvert: 22.44
}
const WORKED_EXAMPLE_DELIVERED_BY_TYPE = {
  Ditches: 41.05,
  Canals: 18.68,
  Culvert: 0.95
}

describe('calculateHabitatNetUnitChanges (AC1)', () => {
  it('returns delivered minus baseline per habitat type, ordered by type', () => {
    const result = calculateHabitatNetUnitChanges(
      WORKED_EXAMPLE_BASELINE_BY_TYPE,
      WORKED_EXAMPLE_DELIVERED_BY_TYPE
    )

    expect(result).toEqual([
      { habitatType: 'Canals', netUnitChange: -6.18 },
      { habitatType: 'Culvert', netUnitChange: -21.49 },
      { habitatType: 'Ditches', netUnitChange: 12.92 }
    ])
  })

  it('covers types present on only one side, treating the missing side as zero', () => {
    const result = calculateHabitatNetUnitChanges(
      { Canals: 10 },
      { Ditches: 4 }
    )

    expect(result).toEqual([
      { habitatType: 'Canals', netUnitChange: -10 },
      { habitatType: 'Ditches', netUnitChange: 4 }
    ])
  })

  it('treats null / non-finite totals as zero', () => {
    const result = calculateHabitatNetUnitChanges(
      { Ditches: null },
      { Ditches: 5 }
    )

    expect(result).toEqual([{ habitatType: 'Ditches', netUnitChange: 5 }])
  })

  it('preserves full precision (no premature rounding to 2 dp)', () => {
    const result = calculateHabitatNetUnitChanges(
      { Ditches: 28.130102 },
      { Ditches: 41.053515 }
    )

    expect(result[0].netUnitChange).toBeCloseTo(12.923413, 6)
  })
})

describe('band aggregate primitives', () => {
  it('sumSurplus sums only strictly positive values', () => {
    expect(sumSurplus([12.92, -6.18, 0])).toBe(12.92)
  })

  it('sumDeficit sums only strictly negative values', () => {
    expect(sumDeficit([12.92, -6.18, 0])).toBe(-6.18)
  })

  it('sumNetChange sums every value regardless of sign', () => {
    expect(sumNetChange([12.92, -6.18, -21.49])).toBe(-14.75)
  })

  it('calculateCumulativeAvailability adds a higher-band surplus to a lower-band net change', () => {
    expect(calculateCumulativeAvailability(12.92, -21.49)).toBe(-8.57)
  })

  it('handles empty inputs as zero', () => {
    expect(sumSurplus()).toBe(0)
    expect(sumDeficit()).toBe(0)
    expect(sumNetChange()).toBe(0)
  })
})

describe('resolveWatercourseDistinctiveness', () => {
  it('maps watercourse types to their statutory band', () => {
    expect(resolveWatercourseDistinctiveness('Ditches').distinctiveness).toBe(
      'Medium'
    )
    expect(resolveWatercourseDistinctiveness('Canals').distinctiveness).toBe(
      'Medium'
    )
    expect(resolveWatercourseDistinctiveness('Culvert').distinctiveness).toBe(
      'Low'
    )
  })

  it('throws for an unknown watercourse type', () => {
    expect(() => resolveWatercourseDistinctiveness('Nope')).toThrow(
      BaselineLookupError
    )
  })
})

describe('calculateWatercourseTradingRules (AC1–AC5)', () => {
  it('reproduces the worked example', () => {
    const result = calculateWatercourseTradingRules(
      WORKED_EXAMPLE_BASELINE_BY_TYPE,
      WORKED_EXAMPLE_DELIVERED_BY_TYPE
    )

    // AC1 — per habitat, with band attached
    expect(result.habitats).toEqual([
      {
        habitatType: 'Canals',
        distinctiveness: 'Medium',
        netUnitChange: -6.18
      },
      {
        habitatType: 'Culvert',
        distinctiveness: 'Low',
        netUnitChange: -21.49
      },
      {
        habitatType: 'Ditches',
        distinctiveness: 'Medium',
        netUnitChange: 12.92
      }
    ])

    // AC2 / AC3 — Medium surplus and deficit
    expect(result.medium).toEqual({ surplus: 12.92, deficit: -6.18 })

    // AC4 / AC5 — Low net change and cumulative availability (12.92 + -21.49)
    expect(result.low).toEqual({
      netChange: -21.49,
      cumulativeAvailability: -8.57
    })
  })

  it('produces zeroed aggregates when there are no watercourses', () => {
    const result = calculateWatercourseTradingRules({}, {})

    expect(result).toEqual({
      habitats: [],
      medium: { surplus: 0, deficit: 0 },
      low: { netChange: 0, cumulativeAvailability: 0 }
    })
  })
})
