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
