import { describe, expect, it } from 'vitest'

import {
  canonicalGeometriesMatch,
  canonicalGeometry,
  canonicalGeometryFromWkt,
  canonicalGeometryStrippedFirst,
  canonicaliseCoordinates,
  geometryFromWkt,
  roundCoordinates
} from './canonical-geometry.js'

const polygon = (ring) => ({ type: 'Polygon', coordinates: [ring] })
const lineString = (points) => ({ type: 'LineString', coordinates: points })
const point = (x, y) => ({ type: 'Point', coordinates: [x, y] })

const SQUARE_RING = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 0]
]
const SQUARE = polygon(SQUARE_RING)

/** Vertices in the large-geometry test: more than a spread argument list can hold. */
const LARGE_VERTEX_COUNT = 130_000

/** True when the two geometries canonicalise to the same shape. */
function sameShape(a, b) {
  return canonicalGeometriesMatch(canonicalGeometry(a), canonicalGeometry(b))
}

/** True when the WKT canonicalises to the same shape as the GeoJSON geometry. */
function wktMatches(wkt, geometry) {
  return canonicalGeometriesMatch(
    canonicalGeometryFromWkt(wkt),
    canonicalGeometry(geometry)
  )
}

describe('geometryFromWkt', () => {
  it('reads the mixed-case type names QGIS writes', () => {
    expect(
      geometryFromWkt('Polygon ((0 0, 100 0, 100 100, 0 100, 0 0))')
    ).toEqual({ type: 'Polygon', coordinates: [SQUARE_RING] })
    expect(geometryFromWkt('LineString (0 250, 50 250)')).toEqual(
      lineString([
        [0, 250],
        [50, 250]
      ])
    )
    expect(geometryFromWkt('Point (20 450)')).toEqual(point(20, 450))
  })

  it('reads the uppercase, fixed-decimal WKT the Python writers produce', () => {
    expect(
      geometryFromWkt(
        'POLYGON ((0.000 0.000, 100.000 0.000, 100.000 100.000, 0.000 100.000, 0.000 0.000))'
      )
    ).toEqual({ type: 'Polygon', coordinates: [SQUARE_RING] })
  })

  it('returns null for blank, non-text and unparseable input', () => {
    expect(geometryFromWkt(null)).toBeNull()
    expect(geometryFromWkt(undefined)).toBeNull()
    expect(geometryFromWkt(42)).toBeNull()
    expect(geometryFromWkt('')).toBeNull()
    expect(geometryFromWkt('   ')).toBeNull()
    expect(geometryFromWkt('not a geometry')).toBeNull()
    expect(geometryFromWkt('Polygon ((0 0, 100 0')).toBeNull()
    expect(geometryFromWkt('POINT (1 2) garbage')).toBeNull()
    expect(
      geometryFromWkt('CurvePolygon ((0 0, 100 0, 100 100, 0 0))')
    ).toBeNull()
  })
})

describe('canonicalGeometryFromWkt', () => {
  it('gives the same shape for QGIS and Python spellings of one geometry', () => {
    expect(
      wktMatches('Polygon ((0 0, 100 0, 100 100, 0 100, 0 0))', SQUARE)
    ).toBe(true)
    expect(
      wktMatches(
        'POLYGON ((0.000 0.000, 100.000 0.000, 100.000 100.000, 0.000 100.000, 0.000 0.000))',
        SQUARE
      )
    ).toBe(true)
  })

  it('returns null for EMPTY geometry', () => {
    expect(canonicalGeometryFromWkt('Polygon EMPTY')).toBeNull()
    expect(canonicalGeometryFromWkt('LINESTRING EMPTY')).toBeNull()
    expect(canonicalGeometryFromWkt('Point EMPTY')).toBeNull()
    expect(canonicalGeometryFromWkt('MultiPolygon EMPTY')).toBeNull()
  })

  it('returns null for garbage, collections and non-finite ordinates', () => {
    expect(canonicalGeometryFromWkt('garbage')).toBeNull()
    expect(
      canonicalGeometryFromWkt('GeometryCollection (Point (1 2))')
    ).toBeNull()
    expect(canonicalGeometryFromWkt('Point (NaN 1)')).toBeNull()
  })
})

describe('canonicalGeometry', () => {
  it('rounds to 3 decimals and keeps only x and y', () => {
    expect(
      canonicalGeometry({
        type: 'LineString',
        coordinates: [
          [0.00049, 1.23456, 7],
          [100.0004, 50.9996, 8]
        ]
      })
    ).toEqual({
      type: 'LINESTRING',
      coordinates: [
        [0, 1.235],
        [100, 51]
      ]
    })
  })

  it('normalises a single-part Multi* geometry to its single type', () => {
    const multi = { type: 'MultiPolygon', coordinates: [[SQUARE_RING]] }
    expect(canonicalGeometry(multi).type).toBe('POLYGON')
    expect(sameShape(multi, SQUARE)).toBe(true)
    expect(
      wktMatches(
        'MultiLineString ((0 0, 10 0))',
        lineString([
          [0, 0],
          [10, 0]
        ])
      )
    ).toBe(true)
    expect(wktMatches('MultiPoint ((20 450))', point(20, 450))).toBe(true)
  })

  it('keeps a Multi* geometry with more than one part as it is', () => {
    const otherRing = SQUARE_RING.map(([x, y]) => [x + 200, y])
    const twoParts = {
      type: 'MultiPolygon',
      coordinates: [[SQUARE_RING], [otherRing]]
    }
    expect(canonicalGeometry(twoParts).type).toBe('MULTIPOLYGON')
    expect(sameShape(twoParts, SQUARE)).toBe(false)
  })

  it('returns null when there is nothing to compare', () => {
    expect(canonicalGeometry(null)).toBeNull()
    expect(canonicalGeometry({ type: 'Polygon' })).toBeNull()
    expect(canonicalGeometry({ type: 'Polygon', coordinates: [] })).toBeNull()
    expect(canonicalGeometry({ type: 'Polygon', coordinates: [[]] })).toBeNull()
    expect(
      canonicalGeometry({ type: 'CircularString', coordinates: [[0, 0]] })
    ).toBeNull()
    // wrong nesting for the type
    expect(
      canonicalGeometry({ type: 'Polygon', coordinates: SQUARE_RING })
    ).toBeNull()
  })

  it('never mutates the geometry it reads', () => {
    const geometry = polygon([
      [0, 0],
      [50.0004, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0]
    ])
    const before = structuredClone(geometry)
    canonicalGeometry(geometry)
    expect(geometry).toEqual(before)
  })
})

describe('roundCoordinates', () => {
  it('rounds a tie away from zero, as toFixed does', () => {
    // 100.0625 is an exact binary value, so it is a true tie at 3 decimals.
    // Python's %.3f writes 100.062 (half to even); toFixed gives 100.063.
    expect(roundCoordinates([100.0625, 50])).toEqual([100.063, 50])
  })
})

describe('canonicalGeometriesMatch', () => {
  it('matches a full-precision baseline with its own 3-decimal WKT', () => {
    const baseline = lineString([
      [467485.4859323712, 227720.9382970471],
      [467484.2069231637, 227686.8646760264],
      [467483.3570158166, 227664.2226022411]
    ])
    expect(
      wktMatches(
        'LineString (467485.486 227720.938, 467484.207 227686.865, 467483.357 227664.223)',
        baseline
      )
    ).toBe(true)
  })

  it('matches only because both sides are rounded before canonicalising', () => {
    // Unrounded, the middle vertex sits 0.96 mm off the line and is stripped
    // as collinear; rounded to (50, 0.001) it sits 1 mm off and survives. The
    // 3-decimal WKT keeps it too, so only rounding both sides agrees.
    const baseline = lineString([
      [0, 0],
      [50.0004, 0.00096],
      [100, 0]
    ])
    expect(wktMatches('LineString (0 0, 50 0.001, 100 0)', baseline)).toBe(true)
  })

  it('treats writers that round a tie differently as the same shape', () => {
    // The Python writers put 100.062 in parent_geom; the backend rounds the
    // baseline's 100.0625 to 100.063.
    expect(wktMatches('POINT (100.062 50.000)', point(100.0625, 50))).toBe(true)
  })

  it('ignores a 1 mm difference', () => {
    expect(
      wktMatches(
        'LineString (0 0, 100.001 50)',
        lineString([
          [0, 0],
          [100, 50]
        ])
      )
    ).toBe(true)
  })

  it('detects a 2 mm edit', () => {
    expect(
      wktMatches(
        'LineString (0 0, 100.002 50)',
        lineString([
          [0, 0],
          [100, 50]
        ])
      )
    ).toBe(false)
  })

  it('detects a 1 cm edit', () => {
    expect(
      wktMatches('Polygon ((0 0, 100.01 0, 100 100, 0 100, 0 0))', SQUARE)
    ).toBe(false)
    expect(wktMatches('Point (20.01 450)', point(20, 450))).toBe(false)
  })

  it('matches a 130,000-vertex baseline with its own 3-decimal WKT', () => {
    // More positions than a spread argument list can hold, so the reader must
    // never spread them, or a genuine large parent would read as drift.
    const coordinates = Array.from({ length: LARGE_VERTEX_COUNT }, (_, i) => [
      467000.1234 + i,
      227000 + (i % 2)
    ])
    const wkt = `LineString (${coordinates
      .map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`)
      .join(', ')})`

    expect(wktMatches(wkt, lineString(coordinates))).toBe(true)
  })

  it('never matches across types, vertex counts or a missing side', () => {
    expect(
      wktMatches('LineString (0 0, 100 0, 100 100, 0 100, 0 0)', SQUARE)
    ).toBe(false)
    expect(
      wktMatches(
        'LineString (0 0, 100 0, 100 100)',
        lineString([
          [0, 0],
          [100, 100]
        ])
      )
    ).toBe(false)
    expect(canonicalGeometriesMatch(null, canonicalGeometry(SQUARE))).toBe(
      false
    )
    expect(canonicalGeometriesMatch(canonicalGeometry(SQUARE), null)).toBe(
      false
    )
  })
})

describe('canonicalGeometryStrippedFirst', () => {
  // A hedge in British National Grid, and the parent_geom its children
  // recorded before a neighbour was sliced with topological editing on.
  const HEDGE_START = [463883.58488036745, 266699.5897312017]
  const HEDGE_A = [463851.5624036727, 266727.8925372318]
  const HEDGE_B = [463818.60232436936, 266674.58556893945]
  const HEDGE_END = [463865.22750951315, 266639.85572280985]
  const HEDGE_WKT =
    'LineString (463883.585 266699.590, 463851.562 266727.893, 463818.602 266674.586, 463865.228 266639.856)'
  // The vertex topological editing inserted on the edge A-B. It lies on the
  // edge at full precision, and 1.12 mm off it once all three are rounded.
  const INSERTED = [463836.71059193864, 266703.8724173193]
  const edited = lineString([
    HEDGE_START,
    HEDGE_A,
    INSERTED,
    HEDGE_B,
    HEDGE_END
  ])

  it('strips an inserted edge vertex that rounding pushes past 1 mm', () => {
    const recorded = canonicalGeometryFromWkt(HEDGE_WKT)

    expect(canonicalGeometriesMatch(recorded, canonicalGeometry(edited))).toBe(
      false
    )
    expect(
      canonicalGeometriesMatch(recorded, canonicalGeometryStrippedFirst(edited))
    ).toBe(true)
  })

  it('still detects a 2 mm edit', () => {
    const moved = lineString([
      HEDGE_START,
      HEDGE_A,
      INSERTED,
      HEDGE_B,
      [HEDGE_END[0] + 0.002, HEDGE_END[1]]
    ])

    expect(
      canonicalGeometriesMatch(
        canonicalGeometryFromWkt(HEDGE_WKT),
        canonicalGeometryStrippedFirst(moved)
      )
    ).toBe(false)
  })

  it('returns null for a geometry that cannot be compared', () => {
    expect(canonicalGeometryStrippedFirst(null)).toBeNull()
    expect(canonicalGeometryStrippedFirst({ type: 'Polygon' })).toBeNull()
    expect(
      canonicalGeometryStrippedFirst({ type: 'Polygon', coordinates: [[]] })
    ).toBeNull()
  })

  it('normalises a single-part MultiPolygon as canonicalGeometry does', () => {
    const multi = { type: 'MultiPolygon', coordinates: [[SQUARE_RING]] }

    expect(canonicalGeometryStrippedFirst(multi)).toEqual(
      canonicalGeometry(SQUARE)
    )
  })
})

// Canonicalisation vectors: shape-preserving vertex noise from QGIS
// topological editing must not read as a changed shape.
describe('canonicalisation vectors', () => {
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
    expect(canonicalGeometry(SQUARE)).toEqual({
      type: 'POLYGON',
      coordinates: [SQUARE_RING]
    })
  })

  it('V2: a collinear midpoint inserted on an edge reads as the clean square', () => {
    expect(sameShape(v2, SQUARE)).toBe(true)
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
    // Same shape as the square, but the ring starts elsewhere: vertex order
    // is significant, because parent_geom is the stored geometry as it was.
    expect(sameShape(v3, SQUARE)).toBe(false)
  })

  it('V4/V4b: a collinear line midpoint is stripped', () => {
    expect(sameShape(v4, v4b)).toBe(true)
  })

  it('V5: a sub-tolerance duplicate first vertex is deduped', () => {
    expect(sameShape(v5, v4)).toBe(true)
  })

  it('V6/V6b: a collinear vertex in real survey coordinates is stripped', () => {
    expect(sameShape(v6, v6b)).toBe(true)
  })

  it('passes Point coordinates through untouched', () => {
    const coordinates = [467485.486, 227720.938]
    expect(canonicaliseCoordinates('Point', coordinates)).toBe(coordinates)
  })
})
