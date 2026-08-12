import { describe, expect, it } from 'vitest'

import { checkDuplicateHabitatRefs } from './duplicate-ref-check.js'
import { ERROR_CODES } from './errors.js'

function area(parcelRef, extra = {}) {
  return {
    properties: {
      'Parcel Ref': parcelRef,
      ...extra
    }
  }
}

describe('checkDuplicateHabitatRefs — no duplicates', () => {
  it('returns null when every Parcel Ref is unique', () => {
    const layers = {
      areas: [area('PR-1'), area('PR-2'), area('PR-3')]
    }
    expect(checkDuplicateHabitatRefs(layers)).toBeNull()
  })

  it('returns null when the areas layer is missing or empty', () => {
    expect(checkDuplicateHabitatRefs({})).toBeNull()
    expect(checkDuplicateHabitatRefs({ areas: [] })).toBeNull()
    expect(checkDuplicateHabitatRefs(null)).toBeNull()
  })

  it('returns null when refs are missing or blank (separate schema concern)', () => {
    const layers = {
      areas: [
        area(null),
        area(''),
        { properties: {} },
        { properties: { 'Parcel Ref': null } }
      ]
    }
    expect(checkDuplicateHabitatRefs(layers)).toBeNull()
  })
})

describe('checkDuplicateHabitatRefs — duplicates present', () => {
  it('flags a single duplicated ref with the matching error code', () => {
    const layers = {
      areas: [area('PR-1'), area('PR-2'), area('PR-1')]
    }
    const err = checkDuplicateHabitatRefs(layers)
    expect(err).not.toBeNull()
    expect(err.code).toBe(ERROR_CODES.DUPLICATE_HABITAT_REF)
    expect(err.details.count).toBe(1)
    expect(err.details.sample).toEqual([
      { ref: 'PR-1', indices: [0, 2], count: 2 }
    ])
    expect(err.message).toContain('PR-1 (2)')
  })

  it('reports every duplicated ref independently with all its indices', () => {
    const layers = {
      areas: [
        area('PR-1'),
        area('PR-2'),
        area('PR-1'),
        area('PR-3'),
        area('PR-2'),
        area('PR-1')
      ]
    }
    const err = checkDuplicateHabitatRefs(layers)
    expect(err.details.count).toBe(2)
    expect(err.details.sample).toEqual([
      { ref: 'PR-1', indices: [0, 2, 5], count: 3 },
      { ref: 'PR-2', indices: [1, 4], count: 2 }
    ])
  })

  it('treats refs as strings (numeric and string forms collide)', () => {
    const layers = {
      areas: [area(1), area('1')]
    }
    const err = checkDuplicateHabitatRefs(layers)
    expect(err).not.toBeNull()
    expect(err.details.sample[0].ref).toBe('1')
  })

  it('accepts underscored Parcel_Ref property names', () => {
    const layers = {
      areas: [
        { properties: { Parcel_Ref: 'PR-A' } },
        { properties: { 'Parcel Ref': 'PR-A' } }
      ]
    }
    const err = checkDuplicateHabitatRefs(layers)
    expect(err).not.toBeNull()
    expect(err.details.sample[0].ref).toBe('PR-A')
  })

  it('ignores blank/null refs even when they coincide', () => {
    const layers = {
      areas: [area(null), area(''), area('PR-1'), area('PR-1')]
    }
    const err = checkDuplicateHabitatRefs(layers)
    expect(err.details.count).toBe(1)
    expect(err.details.sample[0].ref).toBe('PR-1')
  })

  it('caps the sample at 50 entries and appends "and N more" to the message', () => {
    const areas = []
    for (let i = 0; i < 60; i++) {
      areas.push(area(`PR-${i}`))
      areas.push(area(`PR-${i}`))
    }
    const err = checkDuplicateHabitatRefs({ areas })
    expect(err.details.count).toBe(60)
    expect(err.details.sample).toHaveLength(50)
    expect(err.message).toContain('(and 10 more)')
  })
})
