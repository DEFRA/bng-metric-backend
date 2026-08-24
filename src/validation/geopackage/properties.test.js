import { describe, it, expect } from 'vitest'

import { pickProp, buildHabitatLookupKey, PROP_KEYS } from './properties.js'

describe('pickProp', () => {
  it('returns null when properties is null', () => {
    expect(pickProp(null, PROP_KEYS.parcelRef)).toBeNull()
  })

  it('returns null when properties is undefined', () => {
    expect(pickProp(undefined, PROP_KEYS.parcelRef)).toBeNull()
  })

  it('returns the value for an exact-case match', () => {
    expect(pickProp({ 'Parcel Ref': 'H1' }, PROP_KEYS.parcelRef)).toBe('H1')
  })

  it('returns null when no candidate key is present', () => {
    expect(pickProp({ foo: 'bar' }, PROP_KEYS.parcelRef)).toBeNull()
  })

  it('returns the value via case-insensitive fallback', () => {
    // 'PARCEL REF' does not match any exact candidate but normalises to 'parcel ref'
    expect(pickProp({ 'PARCEL REF': 'P9' }, PROP_KEYS.parcelRef)).toBe('P9')
  })

  it('skips null values and continues to the next candidate', () => {
    // First candidate present but null → should look at remaining candidates
    const props = {
      'Baseline Habitat Type': null,
      Baseline_Habitat_Type: 'Lowland meadows'
    }
    expect(pickProp(props, PROP_KEYS.habitatType)).toBe('Lowland meadows')
  })
})

describe('pickProp key index caching', () => {
  // The case-insensitive fallback caches a lowercased key index per properties
  // bag. These pin that the cache cannot leak between bags or go stale.
  it('gives the same answer on repeated calls against one bag', () => {
    const props = { 'Site Name': 'Meadow Farm' }

    expect(pickProp(props, ['site name'])).toBe('Meadow Farm')
    expect(pickProp(props, ['site name'])).toBe('Meadow Farm')
    expect(pickProp(props, ['SITE NAME'])).toBe('Meadow Farm')
  })

  it('keeps separate bags separate', () => {
    const first = { 'Site Name': 'Meadow Farm' }
    const second = { site_name: 'Brook Field' }

    expect(pickProp(first, ['site name'])).toBe('Meadow Farm')
    expect(pickProp(second, ['site name'])).toBeNull()
    expect(pickProp(second, ['SITE_NAME'])).toBe('Brook Field')
    // Re-reading the first must not pick up the second's index.
    expect(pickProp(first, ['site name'])).toBe('Meadow Farm')
  })

  it('does not confuse two bags that carry the same value under different keys', () => {
    const upper = { COMMENT: 'a' }
    const lower = { comment: 'b' }

    expect(pickProp(upper, ['Comment'])).toBe('a')
    expect(pickProp(lower, ['Comment'])).toBe('b')
  })

  it('keeps returning null for a key that is absent', () => {
    // The miss path is what builds and caches the index, so it is the one that
    // must stay correct when called repeatedly.
    const props = { 'Site Name': 'Meadow Farm' }

    expect(pickProp(props, ['nope'])).toBeNull()
    expect(pickProp(props, ['nope'])).toBeNull()
    expect(pickProp(props, ['site name'])).toBe('Meadow Farm')
  })

  it('reads a bag whose keys were added before the first lookup', () => {
    const props = {}
    props['Survey Date'] = '2026-01-01'

    expect(pickProp(props, ['survey date'])).toBe('2026-01-01')
  })
})

describe('buildHabitatLookupKey', () => {
  it('returns null when habitatType is absent', () => {
    expect(buildHabitatLookupKey({})).toBeNull()
  })

  it('passes through a habitatType that already contains the separator', () => {
    const props = {
      'Baseline Habitat Type': 'Grassland - Modified grassland'
    }
    expect(buildHabitatLookupKey(props)).toBe('Grassland - Modified grassland')
  })

  it('concatenates broadType and habitatType when neither contains the separator', () => {
    const props = {
      'Baseline Broad Habitat Type': 'Grassland',
      'Baseline Habitat Type': 'Modified grassland'
    }
    expect(buildHabitatLookupKey(props)).toBe('Grassland - Modified grassland')
  })

  it('returns just the habitatType when broadType is absent', () => {
    expect(
      buildHabitatLookupKey({ 'Baseline Habitat Type': 'Modified grassland' })
    ).toBe('Modified grassland')
  })
})
