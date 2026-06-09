import { describe, expect, it } from 'vitest'

import {
  sumFeatureUnits,
  summarizeFeatureSetUnitsTotals
} from './feature-set-units.js'

describe('sumFeatureUnits', () => {
  it('sums only finite numeric units on features', () => {
    expect(
      sumFeatureUnits([
        { units: 4 },
        { units: 1.5 },
        { units: null },
        {},
        { units: Number.NaN }
      ])
    ).toBe(5.5)
  })

  it('returns 0 for missing or empty arrays', () => {
    expect(sumFeatureUnits(undefined)).toBe(0)
    expect(sumFeatureUnits([])).toBe(0)
  })
})

describe('summarizeFeatureSetUnitsTotals', () => {
  it('sums units per layer and sets totalUnits to their combined total', () => {
    const featureSet = {
      habitats: [{ units: 3 }, { units: 1 }],
      hedgerows: [{ units: 99 }],
      watercourses: []
    }
    summarizeFeatureSetUnitsTotals(featureSet)
    expect(featureSet.units).toEqual({
      totalUnits: 103,
      habitatsTotal: 4,
      hedgerowsTotal: 99,
      watercoursesTotal: 0
    })
  })

  it('emits zero totals when no features have units', () => {
    const featureSet = {
      habitats: [{ ref: 'H1' }],
      hedgerows: [],
      watercourses: []
    }
    summarizeFeatureSetUnitsTotals(featureSet)
    expect(featureSet.units).toEqual({
      totalUnits: 0,
      habitatsTotal: 0,
      hedgerowsTotal: 0,
      watercoursesTotal: 0
    })
  })
})
