import { describe, it, expect } from 'vitest'
import {
  redlineSelfIntersection,
  areaParcelsSelfIntersection
} from './self-intersection.js'

function poly(coords, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [coords] }
  }
}

const cleanSquare = poly([
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0]
])

// Bowtie polygon — self-intersecting at the centre.
const bowtie = poly(
  [
    [0, 0],
    [1, 1],
    [1, 0],
    [0, 1],
    [0, 0]
  ],
  { fid: 7, name: 'Bowtie' }
)

describe('redlineSelfIntersection', () => {
  it('returns null for clean redline', () => {
    expect(redlineSelfIntersection([cleanSquare])).toBeNull()
  })

  it('returns an error for self-intersecting redline', () => {
    const err = redlineSelfIntersection([bowtie])
    expect(err).not.toBeNull()
    expect(err.code).toBe('REDLINE_SELF_INTERSECTING')
  })

  it('returns null when redline list is empty', () => {
    expect(redlineSelfIntersection([])).toBeNull()
  })
})

describe('areaParcelsSelfIntersection', () => {
  it('returns null when all parcels are clean', () => {
    expect(areaParcelsSelfIntersection([cleanSquare, cleanSquare])).toBeNull()
  })

  it('returns an error listing the offending parcels', () => {
    const err = areaParcelsSelfIntersection([cleanSquare, bowtie])
    expect(err).not.toBeNull()
    expect(err.code).toBe('AREA_PARCELS_SELF_INTERSECTING')
    expect(err.offendingFeatures).toEqual([{ id: 7, name: 'Bowtie' }])
  })
})
