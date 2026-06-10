import { describe, test, expect } from 'vitest'

import { distinctivenessByHabitatType } from './habitat-distinctiveness.js'
import {
  getConditionsForHabitatType,
  getConditionsForHedgerowType,
  getConditionsForWatercourseType,
  getHedgerowHabitatTypes,
  getRiparianEncroachmentOptions,
  getWatercourseEncroachmentOptions,
  getWatercourseHabitatTypes
} from './habitat-reference.js'

describe('habitat reference data integrity', () => {
  test('every habitat type in the distinctiveness table has condition options', () => {
    for (const key of Object.keys(distinctivenessByHabitatType)) {
      const conditions = getConditionsForHabitatType(key)
      expect(conditions.length, key).toBeGreaterThan(0)
    }
  })
})

// Real hedgerow reference data is bundled in bng-metric-engine (BMD-427/428).
// These tests exercise the filtering and ordering logic with fixtures so they
// stay decoupled from the engine's data choices; production wiring is
// covered by the default-argument test in each block.
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

  test('returns the engine-bundled hedgerow types in MVS scope (default argument)', () => {
    const result = getHedgerowHabitatTypes()
    expect(result.length).toBeGreaterThan(0)
    const bands = new Set(result.map((r) => r.distinctiveness))
    for (const band of bands) {
      expect(['V.Low', 'Low', 'Medium']).toContain(band)
    }
    // Native hedgerow is the canonical Low-band entry — pin it so any later
    // engine churn that drops it surfaces here rather than silently.
    expect(result.map((r) => r.name)).toContain('Native hedgerow')
  })

  test('V.Low hedgerow types carry score 1 (hedgerow table), not 0 (area table)', () => {
    // The hedgerow distinctiveness table scores V.Low at 1; the area table
    // scores it at 0. Non-native and ornamental hedgerow is the V.Low entry.
    const result = getHedgerowHabitatTypes()
    const vLow = result.find(
      (r) => r.name === 'Non-native and ornamental hedgerow'
    )
    expect(vLow).toMatchObject({
      distinctiveness: 'V.Low',
      distinctivenessScore: 1
    })
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

  test('reads from the engine-bundled scores when called without a fixture', () => {
    // Native hedgerow has Good / Moderate / Poor as the numeric-scoring
    // conditions in the engine reference data; the rest are "Not Possible"
    // and should be filtered out.
    const conditions = getConditionsForHedgerowType('Native hedgerow')
    expect(conditions.map((c) => c.condition)).toEqual([
      'Good',
      'Moderate',
      'Poor'
    ])
    expect(getConditionsForHedgerowType('Made-up')).toEqual([])
  })
})

describe('getWatercourseHabitatTypes (fixture-injected)', () => {
  test('returns entries sorted alphabetically by name', () => {
    const categories = {
      Zebra: 'Low',
      Apple: 'Medium',
      Mango: 'High'
    }
    const names = getWatercourseHabitatTypes(categories).map((r) => r.name)
    expect(names).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  test('keeps every distinctiveness band the engine emits', () => {
    // Watercourse types are not filtered to MVS bands — V.High Priority habitat
    // must remain visible so saved rows are not hidden in the dropdown.
    const categories = {
      VeryHigh: 'V.High',
      High: 'High',
      Medium: 'Medium',
      Low: 'Low'
    }
    const result = getWatercourseHabitatTypes(categories)
    expect(result.map((r) => r.distinctiveness).sort()).toEqual(
      ['High', 'Low', 'Medium', 'V.High'].sort()
    )
  })

  test('attaches the watercourse-table score for each band', () => {
    const result = getWatercourseHabitatTypes({ Priority: 'V.High' })
    expect(result[0]).toMatchObject({
      name: 'Priority',
      distinctiveness: 'V.High',
      distinctivenessScore: 8
    })
  })

  test('returns the engine-bundled types in alphabetical order (default argument)', () => {
    const result = getWatercourseHabitatTypes()
    const names = result.map((r) => r.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(names).toContain('Priority habitat')
    expect(names).toContain('Other rivers and streams')
    expect(names).toContain('Culvert')
  })
})

describe('getConditionsForWatercourseType (fixture-injected)', () => {
  test('returns conditions in canonical order, dropping "Not Possible"', () => {
    const scoresLookup = {
      'Priority habitat': {
        Good: 3,
        'Fairly Good': 2.5,
        Moderate: 2,
        'Fairly Poor': 1.5,
        Poor: 1,
        'Condition Assessment N/A': 'Not Possible'
      }
    }
    expect(
      getConditionsForWatercourseType('Priority habitat', scoresLookup)
    ).toEqual([
      { condition: 'Good', score: 3 },
      { condition: 'Fairly Good', score: 2.5 },
      { condition: 'Moderate', score: 2 },
      { condition: 'Fairly Poor', score: 1.5 },
      { condition: 'Poor', score: 1 }
    ])
  })

  test('returns [] for an unknown watercourse habitat type', () => {
    expect(getConditionsForWatercourseType('Made-up')).toEqual([])
  })

  test('strips "Not Possible" for Culvert, leaving Poor only', () => {
    const conditions = getConditionsForWatercourseType('Culvert')
    expect(conditions.map((c) => c.condition)).toEqual(['Poor'])
  })
})

describe('encroachment option readers', () => {
  test('watercourse encroachment options preserve engine authoring order', () => {
    expect(getWatercourseEncroachmentOptions()).toEqual([
      'No Encroachment',
      'Minor',
      'Major',
      'N/A - Culvert'
    ])
  })

  test('riparian encroachment options include all 11 combinations and N/A - Culvert', () => {
    const options = getRiparianEncroachmentOptions()
    expect(options.length).toBe(11)
    expect(options).toContain('No Encroachment/No Encroachment')
    expect(options).toContain('Major/Major')
    expect(options).toContain('N/A - Culvert')
  })
})
