import { describe, it, expect } from 'vitest'
import { habitatsPresent } from './habitats-present.js'

describe('habitatsPresent', () => {
  it('returns an error when no habitat parcels exist', () => {
    const err = habitatsPresent([])
    expect(err).not.toBeNull()
    expect(err.code).toBe('NO_HABITAT_AREAS')
  })

  it('returns an error when input is undefined', () => {
    const err = habitatsPresent(undefined)
    expect(err).not.toBeNull()
  })

  it('returns null when at least one parcel is present', () => {
    expect(habitatsPresent([{ type: 'Feature' }])).toBeNull()
  })
})
