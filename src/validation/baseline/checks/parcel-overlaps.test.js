import { describe, it, expect } from 'vitest'
import { parcelOverlaps } from './parcel-overlaps.js'

const OVERLAP_OFFSET = 0.005

function squareAt(x, y, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + 0.01, y],
          [x + 0.01, y + 0.01],
          [x, y + 0.01],
          [x, y]
        ]
      ]
    }
  }
}

describe('parcelOverlaps', () => {
  it('returns null when there are fewer than two parcels', () => {
    expect(parcelOverlaps([squareAt(0, 0)])).toBeNull()
    expect(parcelOverlaps([])).toBeNull()
  })

  it('returns null when parcels are disjoint', () => {
    const a = squareAt(0, 0)
    const b = squareAt(0.5, 0.5)
    expect(parcelOverlaps([a, b])).toBeNull()
  })

  it('returns an error listing every overlapping parcel', () => {
    const a = squareAt(0, 0, { fid: 1 })
    const b = squareAt(OVERLAP_OFFSET, OVERLAP_OFFSET, { fid: 2 }) // overlaps with a
    const err = parcelOverlaps([a, b])
    expect(err).not.toBeNull()
    expect(err.code).toBe('PARCEL_OVERLAPS')
    const ids = err.offendingFeatures.map((f) => f.id)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
  })
})
