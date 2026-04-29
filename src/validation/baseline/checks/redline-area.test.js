import { describe, it, expect } from 'vitest'
import { redlineArea } from './redline-area.js'

const SIDE_OVER_LIMIT_M = 11000

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

describe('redlineArea', () => {
  it('returns null for redline well under 100 sq km', () => {
    expect(redlineArea([squareNative(1000)])).toBeNull() // 1 sq km
  })

  it('returns null at exactly 100 sq km', () => {
    expect(redlineArea([squareNative(10000)])).toBeNull() // 100 sq km
  })

  it('returns an error for redline larger than 100 sq km', () => {
    const err = redlineArea([squareNative(SIDE_OVER_LIMIT_M)]) // 121 sq km
    expect(err).not.toBeNull()
    expect(err.code).toBe('REDLINE_AREA_TOO_LARGE')
  })

  it('returns null when redline list is empty', () => {
    expect(redlineArea([])).toBeNull()
  })
})
