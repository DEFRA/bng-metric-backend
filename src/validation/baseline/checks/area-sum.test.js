import { describe, it, expect } from 'vitest'
import { areaSum } from './area-sum.js'

const HABITAT_SIDE_M = 50
const HABITAT_DIAGONAL_M = 86.6025403784

function squareNative(sideMetres) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [] },
    nativeGeometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [sideMetres, 0],
          [sideMetres, sideMetres],
          [0, sideMetres],
          [0, 0]
        ]
      ]
    },
    nativeSrid: 27700
  }
}

describe('areaSum', () => {
  it('returns null when habitat sum equals redline area', () => {
    const redline = [squareNative(100)] // 10 000 sq m
    const habitats = [
      squareNative(HABITAT_SIDE_M),
      squareNative(HABITAT_DIAGONAL_M)
    ]
    // 50² + 86.6025…² ≈ 10 000
    expect(areaSum(redline, habitats)).toBeNull()
  })

  it('returns an error when sum mismatches', () => {
    const redline = [squareNative(100)]
    const habitats = [squareNative(HABITAT_SIDE_M)] // 2 500 sq m, way short
    const err = areaSum(redline, habitats)
    expect(err).not.toBeNull()
    expect(err.code).toBe('AREA_SUM_MISMATCH')
  })

  it('returns null when redline missing', () => {
    expect(areaSum([], [])).toBeNull()
  })
})
