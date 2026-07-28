import { describe, expect, it } from 'vitest'

import { checkAdvanceAndDelayNotBothSet } from './advance-delay-check.js'
import { ERROR_CODES } from './errors.js'

const ADVANCE = 'Habitat created in advance/years'
const DELAY = 'Delay in starting habitat creation/years'

function feature(advance, delay, extra = {}) {
  return {
    properties: {
      [ADVANCE]: advance,
      [DELAY]: delay,
      ...extra
    }
  }
}

describe('checkAdvanceAndDelayNotBothSet — acceptable input', () => {
  it('returns null for advance alone, delay alone, or neither', () => {
    const layers = {
      areas: [
        feature(5, 0, { 'Parcel Ref': 'PR-1' }),
        feature(0, 5, { 'Parcel Ref': 'PR-2' }),
        feature(0, 0, { 'Parcel Ref': 'PR-3' })
      ]
    }
    expect(checkAdvanceAndDelayNotBothSet(layers)).toBeNull()
  })

  it('returns null when layers are missing, empty or null', () => {
    expect(checkAdvanceAndDelayNotBothSet({})).toBeNull()
    expect(checkAdvanceAndDelayNotBothSet({ areas: [] })).toBeNull()
    expect(checkAdvanceAndDelayNotBothSet(null)).toBeNull()
  })

  it('returns null for the N/A literal used on Lost features', () => {
    const layers = { areas: [feature('N/A', 'N/A', { 'Parcel Ref': 'PR-1' })] }
    expect(checkAdvanceAndDelayNotBothSet(layers)).toBeNull()
  })

  it('ignores the Urban Trees layer, whose columns are spelled differently', () => {
    const layers = {
      trees: [feature(5, 5, { 'Tree Ref': 'T-1' })]
    }
    expect(checkAdvanceAndDelayNotBothSet(layers)).toBeNull()
  })
})

describe('checkAdvanceAndDelayNotBothSet — both set', () => {
  it('flags an area habitat with the matching error code', () => {
    const layers = { areas: [feature(5, 5, { 'Parcel Ref': 'PR-1' })] }
    const error = checkAdvanceAndDelayNotBothSet(layers)

    expect(error.code).toBe(ERROR_CODES.ADVANCE_AND_DELAY_BOTH_SET)
    expect(error.details.count).toBe(1)
    expect(error.message).toContain('PR-1')
  })

  it('names both columns in the message', () => {
    const layers = { areas: [feature(1, 1, { 'Parcel Ref': 'PR-1' })] }
    const { message } = checkAdvanceAndDelayNotBothSet(layers)

    expect(message).toContain(ADVANCE)
    expect(message).toContain(DELAY)
  })

  it('flags one year of each — the smallest offending pair', () => {
    const layers = { areas: [feature(1, 1, { 'Parcel Ref': 'PR-1' })] }
    expect(checkAdvanceAndDelayNotBothSet(layers)).not.toBeNull()
  })

  it('covers hedgerows and watercourses, not just areas', () => {
    const layers = {
      hedgerows: [feature(3, 3, { 'Parcel Ref': 'HR-1' })],
      watercourses: [feature(30, 30, { 'Parcel Ref': 'WC-1' })]
    }
    const error = checkAdvanceAndDelayNotBothSet(layers)

    expect(error.details.count).toBe(2)
    expect(error.message).toContain('HR-1')
    expect(error.message).toContain('WC-1')
  })

  it('parses the string forms written by QGIS', () => {
    const layers = { areas: [feature('30+', '2', { 'Parcel Ref': 'PR-1' })] }
    expect(checkAdvanceAndDelayNotBothSet(layers)).not.toBeNull()
  })

  it('falls back to fid, then layer index, when there is no Parcel Ref', () => {
    const withFid = { areas: [feature(5, 5, { fid: 42 })] }
    expect(checkAdvanceAndDelayNotBothSet(withFid).message).toContain('fid 42')

    const bare = { areas: [feature(5, 5)] }
    expect(checkAdvanceAndDelayNotBothSet(bare).message).toContain('feature #0')
  })

  it('caps the sample and says how many more there are', () => {
    const areas = Array.from({ length: 55 }, (_, i) =>
      feature(5, 5, { 'Parcel Ref': `PR-${i}` })
    )
    const error = checkAdvanceAndDelayNotBothSet({ areas })

    expect(error.details.count).toBe(55)
    expect(error.details.sample).toHaveLength(50)
    expect(error.message).toContain('and 5 more')
  })
})
