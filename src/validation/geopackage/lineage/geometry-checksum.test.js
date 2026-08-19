import { describe, expect, it } from 'vitest'

import {
  canonicaliseCoordinates,
  geometryChecksum
} from './geometry-checksum.js'

// Produced by the template's Python implementation (hashlib.sha256 over the
// identical canonical string) for the same square — the cross-language
// contract. If either side changes its recipe, this is the test that notices.
const TEMPLATE_SQUARE_CHECKSUM = '3155b1f1e49d0e51'

const polygon = (ring) => ({ type: 'Polygon', coordinates: [ring] })
const lineString = (points) => ({ type: 'LineString', coordinates: points })

describe('geometryChecksum', () => {
  it('matches the QGIS template Python implementation byte for byte', () => {
    const square = polygon([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0]
    ])
    expect(geometryChecksum(square)).toBe(TEMPLATE_SQUARE_CHECKSUM)
  })

  it('ignores representation noise below a millimetre', () => {
    const a = lineString([
      [0, 0],
      [100.0001, 50]
    ])
    const b = lineString([
      [0, 0],
      [100.0004, 50]
    ])
    expect(geometryChecksum(a)).toBe(geometryChecksum(b))
  })

  it('sees a genuine millimetre-scale edit', () => {
    const a = lineString([
      [0, 0],
      [100, 50]
    ])
    const b = lineString([
      [0, 0],
      [100.002, 50]
    ])
    expect(geometryChecksum(a)).not.toBe(geometryChecksum(b))
  })

  it('returns null when there is nothing to hash', () => {
    expect(geometryChecksum(null)).toBeNull()
    expect(geometryChecksum({ type: 'Polygon' })).toBeNull()
  })
})

// The vectors shared with the template's Python implementation — both sides
// must produce these relationships (and, for V1, this exact value).
describe('canonicalisation shared vectors', () => {
  const v1 = polygon([
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0]
  ])
  const v2 = polygon([
    [0, 0],
    [50, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0]
  ])
  const v3 = polygon([
    [50, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0],
    [50, 0]
  ])
  const v4 = lineString([
    [0, 0],
    [50, 0],
    [100, 0],
    [100, 100]
  ])
  const v4b = lineString([
    [0, 0],
    [100, 0],
    [100, 100]
  ])
  const v5 = lineString([
    [0, 0],
    [0, 0.0004],
    [100, 0],
    [100, 100]
  ])
  const v6 = lineString([
    [467485.4859323712, 227720.9382970471],
    [467484.2069231637, 227686.8646760264],
    [467483.3570158166, 227664.2226022411],
    [467462.75192955433, 227623.01242971647],
    [467423.53579763573, 227566.51461254564],
    [467395.6192291513, 227521.98103901098],
    [467374.3032303991, 227488.00333352556]
  ])
  const v6b = lineString(v6.coordinates.filter((_, index) => index !== 1))

  it('V1: canonicalisation is the identity on the clean square', () => {
    expect(geometryChecksum(v1)).toBe(TEMPLATE_SQUARE_CHECKSUM)
  })

  it('V2: a collinear midpoint inserted on an edge hashes like the clean square', () => {
    expect(geometryChecksum(v2)).toBe(TEMPLATE_SQUARE_CHECKSUM)
  })

  it('V3: a collinear ring-start vertex is stripped by the junction pass', () => {
    const canonical = canonicaliseCoordinates('Polygon', v3.coordinates)
    expect(canonical).toEqual([
      [
        [100, 0],
        [100, 100],
        [0, 100],
        [0, 0],
        [100, 0]
      ]
    ])
    // Same shape as V1 but the ring starts elsewhere, so the hash differs.
    expect(geometryChecksum(v3)).not.toBe(TEMPLATE_SQUARE_CHECKSUM)
  })

  it('V4/V4b: a collinear line midpoint is stripped', () => {
    expect(geometryChecksum(v4)).toBe(geometryChecksum(v4b))
  })

  it('V5: a sub-tolerance duplicate first vertex is deduped', () => {
    expect(geometryChecksum(v5)).toBe(geometryChecksum(v4))
  })

  it('V6/V6b: a collinear vertex in real survey coordinates is stripped', () => {
    expect(geometryChecksum(v6)).toBe(geometryChecksum(v6b))
  })

  it('never mutates the geometry it hashes', () => {
    const before = structuredClone(v2.coordinates)
    geometryChecksum(v2)
    expect(v2.coordinates).toEqual(before)
  })

  it('passes Point coordinates through untouched', () => {
    const coordinates = [467485.486, 227720.938]
    expect(canonicaliseCoordinates('Point', coordinates)).toBe(coordinates)
  })
})
