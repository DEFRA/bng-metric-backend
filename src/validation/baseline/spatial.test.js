import { describe, it, expect } from 'vitest'
import { planarArea } from './spatial.js'

const HOLE_NEAR = 25
const HOLE_FAR = 75
const HOLE_AREA = 2500
const MULTI_NEAR = 100
const MULTI_FAR = 120
const MULTI_AREA = 400

describe('planarArea', () => {
  it('returns 0 for null/undefined geometry', () => {
    expect(planarArea(null)).toBe(0)
    expect(planarArea(undefined)).toBe(0)
  })

  it('computes area of a 100x100 square as 10000 sq m', () => {
    const square = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
          [0, 0]
        ]
      ]
    }
    expect(planarArea(square)).toBe(10000)
  })

  it('subtracts holes from outer ring', () => {
    const polyWithHole = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
          [0, 0]
        ],
        [
          [HOLE_NEAR, HOLE_NEAR],
          [HOLE_FAR, HOLE_NEAR],
          [HOLE_FAR, HOLE_FAR],
          [HOLE_NEAR, HOLE_FAR],
          [HOLE_NEAR, HOLE_NEAR]
        ]
      ]
    }
    expect(planarArea(polyWithHole)).toBe(10000 - HOLE_AREA)
  })

  it('sums area of MultiPolygon parts', () => {
    const multi = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0]
          ]
        ],
        [
          [
            [MULTI_NEAR, MULTI_NEAR],
            [MULTI_FAR, MULTI_NEAR],
            [MULTI_FAR, MULTI_FAR],
            [MULTI_NEAR, MULTI_FAR],
            [MULTI_NEAR, MULTI_NEAR]
          ]
        ]
      ]
    }
    expect(planarArea(multi)).toBe(100 + MULTI_AREA)
  })

  it('returns 0 for unsupported geometry types', () => {
    expect(planarArea({ type: 'Point', coordinates: [0, 0] })).toBe(0)
  })
})
