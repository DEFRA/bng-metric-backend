import { describe, expect, it } from 'vitest'

import { loadGeosRuntime } from './geos-runtime.js'

const runtime = await loadGeosRuntime()

const polygon = (ring) =>
  runtime.fromGeoJson({ type: 'Polygon', coordinates: [ring] })
const SQUARE = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0]
]
const BOWTIE = [
  [0, 0],
  [10, 10],
  [10, 0],
  [0, 10],
  [0, 0]
]

describe('loadGeosRuntime', () => {
  it('is memoised, so a thread compiles the WebAssembly module once', async () => {
    expect(await loadGeosRuntime()).toBe(runtime)
  })

  it('reports the GEOS version, for tying a divergence to a build', () => {
    expect(runtime.version).toMatch(/^\d+\.\d+\.\d+-CAPI-/)
  })
})

describe('measurements', () => {
  it('measures area', () => {
    const g = polygon(SQUARE)
    expect(runtime.area(g)).toBe(100)
    runtime.free(g)
  })

  it('measures length as the perimeter of a ring', () => {
    const g = polygon(SQUARE)
    expect(runtime.length(g)).toBe(40)
    runtime.free(g)
  })

  it('reports a self-cancelling bow-tie as zero area, as ST_Area does', () => {
    const g = polygon(BOWTIE)
    expect(runtime.area(g)).toBe(0)
    runtime.free(g)
  })
})

describe('validity', () => {
  it('accepts a simple ring', () => {
    const g = polygon(SQUARE)
    expect(runtime.isValid(g)).toBe(true)
    runtime.free(g)
  })

  it('rejects a self-intersecting ring and names the reason and the place', () => {
    const g = polygon(BOWTIE)
    const detail = runtime.validDetail(g)
    expect(detail.valid).toBe(false)
    expect(detail.reason).toBe('Self-intersection')
    expect(runtime.toWkt(detail.location)).toBe('POINT(5 5)')
    runtime.free(detail.location)
    runtime.free(g)
  })

  it('returns no reason or location for a valid geometry', () => {
    const g = polygon(SQUARE)
    const detail = runtime.validDetail(g)
    expect(detail).toMatchObject({ valid: true, reason: null, location: null })
    runtime.free(g)
  })
})

describe('WKT', () => {
  // These strings reach the user, interpolated into the error message. GEOS
  // writes `POLYGON ((1 2, 3 4))`; PostGIS writes `POLYGON((1 2,3 4))`. Left
  // alone, switching engines would visibly change every message carrying a
  // location.
  it('uses PostGIS punctuation, not the GEOS/ISO spacing', () => {
    const g = polygon(SQUARE)
    expect(runtime.toWkt(g)).toBe('POLYGON((0 0,10 0,10 10,0 10,0 0))')
    runtime.free(g)
  })

  it('prints the same digits PostGIS does, rather than rounding', () => {
    const g = polygon([
      [530000.123456789, 180000.5],
      [530001.1, 180000.000000001],
      [530000.7, 180001.25],
      [530000.123456789, 180000.5]
    ])
    expect(runtime.toWkt(g)).toBe(
      'POLYGON((530000.123456789 180000.5,530001.1 180000.000000001,530000.7 180001.25,530000.123456789 180000.5))'
    )
    runtime.free(g)
  })

  it('leaves an EMPTY geometry alone', () => {
    const g = runtime.geos.GEOSGeom_createEmptyPolygon()
    expect(runtime.toWkt(g)).toBe('POLYGON EMPTY')
    runtime.free(g)
  })
})

describe('unionAll', () => {
  it('dissolves overlapping geometries into one, like the ST_Union aggregate', () => {
    const a = polygon(SQUARE)
    const b = polygon([
      [5, 5],
      [15, 5],
      [15, 15],
      [5, 15],
      [5, 5]
    ])
    const dissolved = runtime.unionAll([a, b])
    expect(runtime.area(dissolved)).toBe(175)
    runtime.free(dissolved)
  })

  it('returns null for nothing to dissolve, matching ST_Union over zero rows', () => {
    expect(runtime.unionAll([])).toBeNull()
  })
})

describe('free', () => {
  it('tolerates a null pointer, so callers need not guard', () => {
    expect(() => runtime.free(null)).not.toThrow()
  })
})
