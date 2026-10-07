import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from './errors.js'
import {
  checkTreeCountIsWhole,
  isBlankTreeCount,
  isWholeTreeCount
} from './tree-count-check.js'

function tree(count, extra = {}) {
  return { properties: { Count: count, ...extra } }
}

describe('isBlankTreeCount', () => {
  it.each([undefined, null, '', '   '])('treats %j as blank', (value) => {
    expect(isBlankTreeCount(value)).toBe(true)
  })

  it.each([0, 1, '1', 2.5, 'two'])('treats %j as filled in', (value) => {
    expect(isBlankTreeCount(value)).toBe(false)
  })
})

describe('isWholeTreeCount', () => {
  it.each([1, 3, '2', 10.0, '7.0'])('accepts %j', (value) => {
    expect(isWholeTreeCount(value)).toBe(true)
  })

  it.each([0, -1, 2.5, '0.3', 'two', Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %j',
    (value) => {
      expect(isWholeTreeCount(value)).toBe(false)
    }
  )
})

describe('checkTreeCountIsWhole — acceptable input', () => {
  it('returns null for whole counts, as numbers or numeric text', () => {
    const layers = {
      trees: [
        tree(1, { 'Tree Ref': 'T-1' }),
        tree('3', { 'Tree Ref': 'T-2' }),
        tree(12, { 'Tree Ref': 'T-3' })
      ]
    }
    expect(checkTreeCountIsWhole(layers)).toBeNull()
  })

  it('returns null for a blank count, which the metric reads as one tree', () => {
    const layers = {
      trees: [
        tree(null, { 'Tree Ref': 'T-1' }),
        tree('', { 'Tree Ref': 'T-2' }),
        tree('  ', { 'Tree Ref': 'T-3' }),
        { properties: { 'Tree Ref': 'T-4' } }
      ]
    }
    expect(checkTreeCountIsWhole(layers)).toBeNull()
  })

  it('returns null when the trees layer is missing, empty or null', () => {
    expect(checkTreeCountIsWhole({})).toBeNull()
    expect(checkTreeCountIsWhole({ trees: [] })).toBeNull()
    expect(checkTreeCountIsWhole(null)).toBeNull()
  })

  it('ignores the other layers, which have no Count column', () => {
    const layers = { areas: [{ properties: { Count: 2.5 } }] }
    expect(checkTreeCountIsWhole(layers)).toBeNull()
  })
})

describe('checkTreeCountIsWhole — not a whole number of trees', () => {
  it('flags a fractional count with the matching error code', () => {
    const layers = { trees: [tree(2.5, { 'Tree Ref': 'T-1' })] }
    const error = checkTreeCountIsWhole(layers)

    expect(error.code).toBe(ERROR_CODES.TREE_COUNT_NOT_WHOLE)
    expect(error.details.count).toBe(1)
    expect(error.details.sample).toEqual([
      { feature_ref: 'T-1', fid: null, idx: 0, count: 2.5 }
    ])
  })

  it.each([0, -1, '0.3', 'two'])('flags a count of %j', (count) => {
    const layers = { trees: [tree(count, { 'Tree Ref': 'T-1' })] }
    expect(checkTreeCountIsWhole(layers)).not.toBeNull()
  })

  it('names the column, the tree and the value in the message', () => {
    const layers = { trees: [tree(2.5, { 'Tree Ref': 'T-1' })] }
    const { message } = checkTreeCountIsWhole(layers)

    expect(message).toContain('"Count"')
    expect(message).toContain('Tree Ref T-1 (2.5)')
    expect(message).toContain('leave it blank for one tree')
  })

  it('falls back to the fid, then the position, when a tree has no ref', () => {
    const layers = {
      trees: [tree(0, { fid: 7 }), tree(0)]
    }
    const error = checkTreeCountIsWhole(layers)

    expect(error.details.count).toBe(2)
    expect(error.details.sample[0]).toMatchObject({ feature_ref: null, fid: 7 })
    expect(error.message).toContain('fid 7 (0)')
    expect(error.message).toContain('feature #1 (0)')
  })

  it('counts every offender but samples at most 50', () => {
    const trees = Array.from({ length: 60 }, (_, i) =>
      tree(1.5, { 'Tree Ref': `T-${i}` })
    )
    const error = checkTreeCountIsWhole({ trees })

    expect(error.details.count).toBe(60)
    expect(error.details.sample).toHaveLength(50)
    expect(error.message).toContain('(and 10 more)')
  })

  it('reports only the offending trees among valid ones', () => {
    const layers = {
      trees: [
        tree(1, { 'Tree Ref': 'T-1' }),
        tree(2.5, { 'Tree Ref': 'T-2' }),
        tree(null, { 'Tree Ref': 'T-3' })
      ]
    }
    const error = checkTreeCountIsWhole(layers)

    expect(error.details.count).toBe(1)
    expect(error.details.sample[0].feature_ref).toBe('T-2')
  })
})
