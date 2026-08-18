import { describe, expect, it } from 'vitest'

import { geometryChecksum } from './geometry-checksum.js'

// Produced by the template's Python implementation (hashlib.sha256 over the
// identical canonical string) for the same square — the cross-language
// contract. If either side changes its recipe, this is the test that notices.
const TEMPLATE_SQUARE_CHECKSUM = '3155b1f1e49d0e51'

describe('geometryChecksum', () => {
  it('matches the QGIS template Python implementation byte for byte', () => {
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
    expect(geometryChecksum(square)).toBe(TEMPLATE_SQUARE_CHECKSUM)
  })

  it('ignores representation noise below a millimetre', () => {
    const a = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [100.0001, 50]
      ]
    }
    const b = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [100.0004, 50]
      ]
    }
    expect(geometryChecksum(a)).toBe(geometryChecksum(b))
  })

  it('sees a genuine millimetre-scale edit', () => {
    const a = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [100, 50]
      ]
    }
    const b = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [100.002, 50]
      ]
    }
    expect(geometryChecksum(a)).not.toBe(geometryChecksum(b))
  })

  it('returns null when there is nothing to hash', () => {
    expect(geometryChecksum(null)).toBeNull()
    expect(geometryChecksum({ type: 'Polygon' })).toBeNull()
  })
})
