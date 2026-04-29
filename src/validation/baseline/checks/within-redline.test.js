import { describe, it, expect } from 'vitest'
import { withinRedline } from './within-redline.js'

// Redline is a 10×10 box at the origin. Coordinates below are relative to it.
const NEAR_EDGE_INSIDE = 9
const JUST_OUTSIDE = 11
const HEDGE_END_X = 12
const TREE_X = 15
const MID_INSIDE = 5

function poly(coords, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [coords] }
  }
}

function point(coord, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: coord }
  }
}

function lineString(coords, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: coords }
  }
}

const redline = [
  poly([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0]
  ])
]

describe('withinRedline', () => {
  it('returns null when an area habitat is fully inside the redline', () => {
    const habitat = poly([
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
      [1, 1]
    ])
    expect(withinRedline('areas', [habitat], redline)).toBeNull()
  })

  it('flags habitats that extend outside the redline', () => {
    const habitat = poly(
      [
        [NEAR_EDGE_INSIDE, NEAR_EDGE_INSIDE],
        [JUST_OUTSIDE, NEAR_EDGE_INSIDE],
        [JUST_OUTSIDE, JUST_OUTSIDE],
        [NEAR_EDGE_INSIDE, JUST_OUTSIDE],
        [NEAR_EDGE_INSIDE, NEAR_EDGE_INSIDE]
      ],
      { fid: 42 }
    )
    const err = withinRedline('areas', [habitat], redline)
    expect(err).not.toBeNull()
    expect(err.code).toBe('AREA_PARCELS_OUTSIDE_REDLINE')
    expect(err.offendingFeatures).toEqual([{ id: 42 }])
  })

  it('flags hedgerows outside the redline', () => {
    const hedge = lineString(
      [
        [NEAR_EDGE_INSIDE, MID_INSIDE],
        [HEDGE_END_X, MID_INSIDE]
      ],
      { fid: 1 }
    )
    const err = withinRedline('hedgerows', [hedge], redline)
    expect(err).not.toBeNull()
    expect(err.code).toBe('HEDGEROWS_OUTSIDE_REDLINE')
  })

  it('flags trees outside the redline', () => {
    const tree = point([TREE_X, MID_INSIDE], { fid: 9 })
    const err = withinRedline('trees', [tree], redline)
    expect(err).not.toBeNull()
    expect(err.code).toBe('TREES_OUTSIDE_REDLINE')
  })

  it('returns null for an empty layer', () => {
    expect(withinRedline('iggis', [], redline)).toBeNull()
  })

  it('throws on unknown layer name', () => {
    expect(() => withinRedline('whatever', [], redline)).toThrow()
  })
})
