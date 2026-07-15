import { describe, expect, it } from 'vitest'

import { calculatePostInterventionNetUnitChanges } from './net-unit-change.js'

describe('calculatePostInterventionNetUnitChanges', () => {
  it('calculates net unit changes and percentages using baseline unit totals', () => {
    const result = calculatePostInterventionNetUnitChanges(
      {
        habitatsTotal: 10,
        treesTotal: 2,
        hedgerowsTotal: 4,
        watercoursesTotal: 10
      },
      {
        habitatsTotal: 12,
        treesTotal: 3,
        hedgerowsTotal: 6,
        watercoursesTotal: 5
      }
    )

    expect(result).toEqual({
      habitatsNetUnitChange: 3,
      habitatsNetUnitChangePercentage: 25,
      hedgerowsNetUnitChange: 2,
      hedgerowsNetUnitChangePercentage: 50,
      watercoursesNetUnitChange: -5,
      watercoursesNetUnitChangePercentage: -50
    })
  })

  it('sets percentage change to null when the baseline total is zero', () => {
    const result = calculatePostInterventionNetUnitChanges(
      {
        habitatsTotal: 0,
        hedgerowsTotal: 0,
        watercoursesTotal: 0
      },
      {
        habitatsTotal: 3,
        hedgerowsTotal: 2,
        watercoursesTotal: 1
      }
    )

    expect(result).toEqual({
      habitatsNetUnitChange: 3,
      habitatsNetUnitChangePercentage: null,
      hedgerowsNetUnitChange: 2,
      hedgerowsNetUnitChangePercentage: null,
      watercoursesNetUnitChange: 1,
      watercoursesNetUnitChangePercentage: null
    })
  })

  it('treats missing or non-finite totals as zero', () => {
    const result = calculatePostInterventionNetUnitChanges(
      {
        habitatsTotal: 1,
        treesTotal: Number.NaN,
        hedgerowsTotal: Infinity
      },
      {
        habitatsTotal: 2,
        treesTotal: 1,
        hedgerowsTotal: 3,
        watercoursesTotal: 4
      }
    )

    expect(result).toEqual({
      habitatsNetUnitChange: 2,
      habitatsNetUnitChangePercentage: 200,
      hedgerowsNetUnitChange: 3,
      hedgerowsNetUnitChangePercentage: null,
      watercoursesNetUnitChange: 4,
      watercoursesNetUnitChangePercentage: null
    })
  })
})
