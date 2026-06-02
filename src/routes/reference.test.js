import { describe, test, expect } from 'vitest'

import {
  getBroadHabitats,
  getHabitatTypes,
  getHabitatTypesByBroad,
  getConditions,
  getHedgerowTypes,
  getTradingRules
} from './reference.js'
import { getHedgerowHabitatTypes } from '../validation/baseline/reference/habitat-reference.js'

describe('#getBroadHabitats', () => {
  test('Returns an alphabetised list of broad habitats', () => {
    const result = getBroadHabitats.handler({}, {})
    expect(Array.isArray(result)).toBe(true)
    const sorted = [...result].sort((a, b) => a.localeCompare(b))
    expect(result).toEqual(sorted)
  })

  test('Excludes broads with no V.Low/Low/Medium habitat types', () => {
    const result = getBroadHabitats.handler({}, {})
    // Wetland is V.High only — should be excluded
    expect(result).not.toContain('Wetland')
    // Coastal lagoons is High only — should be excluded
    expect(result).not.toContain('Coastal lagoons')
    // Rocky shore is High/V.High only — should be excluded
    expect(result).not.toContain('Rocky shore')
  })

  test('Includes broads with Medium or Low entries', () => {
    const result = getBroadHabitats.handler({}, {})
    expect(result).toContain('Cropland')
    expect(result).toContain('Grassland')
    expect(result).toContain('Urban')
  })
})

describe('#getHabitatTypes', () => {
  test('Returns the alphabetised habitat types for a broad habitat', () => {
    const request = { query: { broad: 'Cropland' } }
    const result = getHabitatTypes.handler(request, {})
    expect(result.length).toBeGreaterThan(0)
    expect(result.map((t) => t.name)).toContain('Cereal crops')
    const sorted = [...result].sort((a, b) => a.name.localeCompare(b.name))
    expect(result).toEqual(sorted)
  })

  test('Each entry carries its distinctiveness band and score', () => {
    const request = { query: { broad: 'Grassland' } }
    const result = getHabitatTypes.handler(request, {})
    const modifiedGrassland = result.find(
      (t) => t.name === 'Modified grassland'
    )
    expect(modifiedGrassland).toEqual({
      name: 'Modified grassland',
      distinctiveness: 'Low',
      distinctivenessScore: 2
    })
  })

  test('Excludes habitat types with High or V.High distinctiveness', () => {
    const request = { query: { broad: 'Grassland' } }
    const result = getHabitatTypes.handler(request, {})
    const names = result.map((t) => t.name)
    // Lowland meadows is V.High — must be excluded
    expect(names).not.toContain('Lowland meadows')
    // Modified grassland is Low — must be included
    expect(names).toContain('Modified grassland')
  })

  test('Returns empty array for an unknown broad habitat', () => {
    const request = { query: { broad: 'Not a real broad' } }
    expect(getHabitatTypes.handler(request, {})).toEqual([])
  })
})

describe('#getHabitatTypes validation', () => {
  const schema = getHabitatTypes.options.validate.query

  test('Passes with a broad query param', () => {
    const { error } = schema.validate({ broad: 'Cropland' })
    expect(error).toBeUndefined()
  })

  test('Fails when broad is missing', () => {
    const { error } = schema.validate({})
    expect(error).toBeDefined()
    expect(error.message).toContain('"broad" is required')
  })

  test('Fails when broad is empty', () => {
    const { error } = schema.validate({ broad: '' })
    expect(error).toBeDefined()
  })
})

describe('#getHabitatTypesByBroad', () => {
  test('Returns the full lookup grouped by broad habitat', () => {
    const result = getHabitatTypesByBroad.handler({}, {})
    expect(typeof result).toBe('object')
    expect(Object.keys(result).length).toBeGreaterThan(0)
    expect(result).toHaveProperty('Grassland')
    expect(result).toHaveProperty('Cropland')
  })

  test('Each entry carries name, distinctiveness, and distinctivenessScore', () => {
    const result = getHabitatTypesByBroad.handler({}, {})
    const modifiedGrassland = result.Grassland.find(
      (t) => t.name === 'Modified grassland'
    )
    expect(modifiedGrassland).toEqual({
      name: 'Modified grassland',
      distinctiveness: 'Low',
      distinctivenessScore: 2
    })
  })

  test('Habitat types within each broad are sorted alphabetically', () => {
    const result = getHabitatTypesByBroad.handler({}, {})
    for (const types of Object.values(result)) {
      const sorted = [...types].sort((a, b) => a.name.localeCompare(b.name))
      expect(types).toEqual(sorted)
    }
  })

  test('Excludes broads whose only types are High or V.High', () => {
    const result = getHabitatTypesByBroad.handler({}, {})
    expect(result).not.toHaveProperty('Wetland')
    expect(result).not.toHaveProperty('Coastal lagoons')
  })
})

describe('#getConditions', () => {
  test('Returns the five-band scale for a grassland habitat type', () => {
    const request = {
      query: { habitatType: 'Grassland - Modified grassland' }
    }
    const result = getConditions.handler(request, {})
    expect(result).toEqual([
      { condition: 'Good', score: 3 },
      { condition: 'Fairly Good', score: 2.5 },
      { condition: 'Moderate', score: 2 },
      { condition: 'Fairly Poor', score: 1.5 },
      { condition: 'Poor', score: 1 }
    ])
  })

  test('Returns Condition Assessment N/A for cropland habitats', () => {
    const request = {
      query: { habitatType: 'Cropland - Cereal crops' }
    }
    const result = getConditions.handler(request, {})
    expect(result).toEqual([
      { condition: 'Condition Assessment N/A', score: 1 }
    ])
  })

  test('Returns N/A - Other for sealed urban surfaces', () => {
    const request = {
      query: { habitatType: 'Urban - Developed land; sealed surface' }
    }
    const result = getConditions.handler(request, {})
    expect(result).toEqual([{ condition: 'N/A - Other', score: 0 }])
  })

  test('Returns empty array for unknown habitat type', () => {
    const request = { query: { habitatType: 'Not a real habitat' } }
    expect(getConditions.handler(request, {})).toEqual([])
  })

  test('Dispatches to hedgerow lookup when featureType=hedgerow', () => {
    // An area-shaped key has no entry in the hedgerow table; conversely a
    // hedgerow type returns hedgerow conditions. Pins the dispatch and the
    // wiring to the engine-bundled hedgerow data.
    expect(
      getConditions.handler(
        {
          query: {
            habitatType: 'Grassland - Modified grassland',
            featureType: 'hedgerow'
          }
        },
        {}
      )
    ).toEqual([])
    const hedgerowConditions = getConditions.handler(
      {
        query: { habitatType: 'Native hedgerow', featureType: 'hedgerow' }
      },
      {}
    )
    expect(hedgerowConditions.map((c) => c.condition)).toEqual([
      'Good',
      'Moderate',
      'Poor'
    ])
  })
})

describe('#getConditions validation', () => {
  const schema = getConditions.options.validate.query

  test('Defaults featureType to "habitat" when omitted', () => {
    const { value, error } = schema.validate({
      habitatType: 'Grassland - Modified grassland'
    })
    expect(error).toBeUndefined()
    expect(value.featureType).toBe('habitat')
  })

  test('Accepts featureType=hedgerow', () => {
    const { value, error } = schema.validate({
      habitatType: 'Native hedgerow',
      featureType: 'hedgerow'
    })
    expect(error).toBeUndefined()
    expect(value.featureType).toBe('hedgerow')
  })

  test('Rejects unsupported featureType', () => {
    const { error } = schema.validate({
      habitatType: 'River',
      featureType: 'watercourse'
    })
    expect(error).toBeDefined()
  })
})

describe('#getHedgerowTypes', () => {
  test('Returns the MVS-scope hedgerow types in alphabetical order', () => {
    const result = getHedgerowTypes.handler({}, {})
    expect(result.length).toBeGreaterThan(0)
    const names = result.map((r) => r.name)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
    for (const entry of result) {
      expect(['V.Low', 'Low', 'Medium']).toContain(entry.distinctiveness)
    }
    expect(names).toContain('Native hedgerow')
  })

  test('handler delegates to getHedgerowHabitatTypes', () => {
    expect(getHedgerowTypes.handler({}, {})).toEqual(getHedgerowHabitatTypes())
  })
})

describe('#getTradingRules', () => {
  test('Returns guidance text for all five distinctiveness bands', () => {
    const result = getTradingRules.handler({}, {})
    expect(Object.keys(result).sort()).toEqual(
      ['High', 'Low', 'Medium', 'V.High', 'V.Low'].sort()
    )
    expect(result.Medium).toContain('Same broad habitat')
    expect(result['V.Low']).toContain('Not Required')
  })
})
