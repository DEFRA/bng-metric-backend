import { describe, test, expect } from 'vitest'

import { distinctivenessByHabitatType } from './habitat-distinctiveness.js'
import {
  getConditionsForHabitatType,
  getConditionsForHedgerowType,
  getHedgerowHabitatTypes
} from './habitat-reference.js'

describe('habitat reference data integrity', () => {
  test('every habitat type in the distinctiveness table has condition options', () => {
    for (const key of Object.keys(distinctivenessByHabitatType)) {
      const conditions = getConditionsForHabitatType(key)
      expect(conditions.length, key).toBeGreaterThan(0)
    }
  })
})

// The hedgerow reference data won't ship until BMD-427/428, so the production
// lookup tables are empty placeholders. These tests inject fixture data
// through the optional parameter to exercise the filtering and ordering
// logic so it doesn't decay before real data lands.
describe('getHedgerowHabitatTypes (fixture-injected)', () => {
  test('returns entries sorted alphabetically by name', () => {
    const categories = {
      Zebra: 'Low',
      Apple: 'Medium',
      Mango: 'Low'
    }
    const result = getHedgerowHabitatTypes(categories)
    expect(result.map((r) => r.name)).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  test('drops bands outside the MVS scope (High and V.High)', () => {
    const categories = {
      Keep1: 'V.Low',
      Keep2: 'Low',
      Keep3: 'Medium',
      Drop1: 'High',
      Drop2: 'V.High'
    }
    const names = getHedgerowHabitatTypes(categories).map((r) => r.name)
    expect(names).toEqual(['Keep1', 'Keep2', 'Keep3'])
  })

  test('attaches distinctiveness and the numeric distinctivenessScore', () => {
    const result = getHedgerowHabitatTypes({ Sample: 'Low' })
    expect(result).toEqual([
      {
        name: 'Sample',
        distinctiveness: 'Low',
        distinctivenessScore: expect.any(Number)
      }
    ])
    expect(result[0].distinctivenessScore).toBeGreaterThan(0)
  })

  test('returns [] when no entries match the MVS scope', () => {
    expect(getHedgerowHabitatTypes({ Only: 'High' })).toEqual([])
  })

  test('returns [] for the empty placeholder (default argument)', () => {
    expect(getHedgerowHabitatTypes()).toEqual([])
  })
})

describe('getConditionsForHedgerowType (fixture-injected)', () => {
  test('returns conditions in the engine-defined order, dropping "Not Possible"', () => {
    const scoresLookup = {
      'Native hedgerow': {
        Good: 3,
        Moderate: 2,
        Poor: 1,
        'N/A - Other': 'Not Possible'
      }
    }
    expect(
      getConditionsForHedgerowType('Native hedgerow', scoresLookup)
    ).toEqual([
      { condition: 'Good', score: 3 },
      { condition: 'Moderate', score: 2 },
      { condition: 'Poor', score: 1 }
    ])
  })

  test('returns [] for an unknown habitat type', () => {
    const scoresLookup = { 'Native hedgerow': { Good: 3 } }
    expect(getConditionsForHedgerowType('Made-up', scoresLookup)).toEqual([])
  })

  test('returns [] for the empty placeholder (default argument)', () => {
    expect(getConditionsForHedgerowType('Anything')).toEqual([])
  })
})
