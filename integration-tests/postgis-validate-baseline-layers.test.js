import { afterAll, describe, expect, it } from 'vitest'
import pg from 'pg'

import { validateBaselineLayersPostgis } from '../src/validation/baseline/postgis/index.js'
import { getDbConfig } from './helpers/db.js'

const BNG_SRID = 27700

// EPSG:27700 metres around central London. The numbers themselves don't
// matter — they just need to be inside England-ish space and far from the
// origin. Building rings from these constants keeps each polygon literal
// composed of named values rather than bare coordinates.
const X0 = 530_000
const Y0 = 180_000
const EDGE = 100
const HALF = EDGE / 2

const pool = new pg.Pool(getDbConfig())

afterAll(async () => {
  await pool.end().catch(() => {})
})

function poly(ring, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [ring] },
    nativeGeometry: { type: 'Polygon', coordinates: [ring] },
    nativeSrid: BNG_SRID
  }
}

function line(coords, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: coords },
    nativeGeometry: { type: 'LineString', coordinates: coords },
    nativeSrid: BNG_SRID
  }
}

function point(coords, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: coords },
    nativeGeometry: { type: 'Point', coordinates: coords },
    nativeSrid: BNG_SRID
  }
}

const SQUARE = [
  [X0, Y0],
  [X0 + EDGE, Y0],
  [X0 + EDGE, Y0 + EDGE],
  [X0, Y0 + EDGE],
  [X0, Y0]
]

const SQUARE_OFFSET = [
  [X0 + HALF, Y0 + HALF],
  [X0 + HALF + EDGE, Y0 + HALF],
  [X0 + HALF + EDGE, Y0 + HALF + EDGE],
  [X0 + HALF, Y0 + HALF + EDGE],
  [X0 + HALF, Y0 + HALF]
]

const SELF_INTERSECTING = [
  [X0, Y0],
  [X0 + EDGE, Y0 + EDGE],
  [X0 + EDGE, Y0],
  [X0, Y0 + EDGE],
  [X0, Y0]
]

const BIG = [
  [X0 - EDGE, Y0 - EDGE],
  [X0 + 2 * EDGE, Y0 - EDGE],
  [X0 + 2 * EDGE, Y0 + 2 * EDGE],
  [X0 - EDGE, Y0 + 2 * EDGE],
  [X0 - EDGE, Y0 - EDGE]
]

// Glasgow-ish coordinates in BNG — inside the British National Grid range
// but outside the England reference polygon.
const SCOTLAND_X = 300_000
const SCOTLAND_Y = 700_000
const OUTSIDE_ENGLAND = [
  [SCOTLAND_X, SCOTLAND_Y],
  [SCOTLAND_X + EDGE, SCOTLAND_Y],
  [SCOTLAND_X + EDGE, SCOTLAND_Y + EDGE],
  [SCOTLAND_X, SCOTLAND_Y + EDGE],
  [SCOTLAND_X, SCOTLAND_Y]
]

// 11 km x 11 km = 121 sq km, exceeds the 100 sq km cap.
const HUGE_EDGE = 11_000
const HUGE = [
  [X0, Y0],
  [X0 + HUGE_EDGE, Y0],
  [X0 + HUGE_EDGE, Y0 + HUGE_EDGE],
  [X0, Y0 + HUGE_EDGE],
  [X0, Y0]
]

// Side length (in metres) of the triangular corner cut from NOTCHED_SQUARE.
// 0.8 m × 0.8 m / 2 = 0.32 sq m, which sits inside the (0, 1) sliver range
// and below the 0.5 sq m AREA_SUM_MISMATCH tolerance.
const NOTCH_SIDE_M = 0.8

// SQUARE with a small triangular corner cut off (~0.32 sq m). When used as
// the only habitat against the SQUARE redline, the gap shows up as a sliver
// (area in the (0, SLIVER_THRESHOLD_SQ_M) range) without tripping
// AREA_SUM_MISMATCH.
const NOTCHED_SQUARE = [
  [X0 + NOTCH_SIDE_M, Y0],
  [X0 + EDGE, Y0],
  [X0 + EDGE, Y0 + EDGE],
  [X0, Y0 + EDGE],
  [X0, Y0 + NOTCH_SIDE_M],
  [X0 + NOTCH_SIDE_M, Y0]
]

// HALF the area of SQUARE, fully inside it. Triggers AREA_SUM_MISMATCH
// (sums differ by 7500 sq m) without tripping PARCEL_OUTSIDE_REDLINE
// (parcel ⊂ redline) or SLIVERS (the leftover gap is far above the
// SLIVER_THRESHOLD_SQ_M cutoff).
const HALF_SQUARE = [
  [X0, Y0],
  [X0 + HALF, Y0],
  [X0 + HALF, Y0 + HALF],
  [X0, Y0 + HALF],
  [X0, Y0]
]

// Line / point fixtures that span from inside to outside SQUARE.
const LINE_SPANNING = [
  [X0 + HALF, Y0 + HALF],
  [X0 + 2 * EDGE, Y0 + 2 * EDGE]
]
const POINT_OUTSIDE = [X0 - EDGE, Y0 - EDGE]

function makeLayers(overrides = {}) {
  return {
    redline: [],
    areas: [],
    hedgerows: [],
    watercourses: [],
    iggis: [],
    trees: [],
    ...overrides
  }
}

async function runAndGetCodes(layers) {
  const result = await validateBaselineLayersPostgis(pool, layers)
  return result.errors.map((e) => e.code)
}

describe('validateBaselineLayersPostgis — happy path', () => {
  it('returns no topology errors for redline == single habitat', async () => {
    const codes = await runAndGetCodes(
      makeLayers({ redline: [poly(SQUARE)], areas: [poly(SQUARE)] })
    )
    expect(codes).not.toContain('REDLINE_INVALID_GEOMETRY')
    expect(codes).not.toContain('AREA_PARCELS_INVALID_GEOMETRY')
    expect(codes).not.toContain('PARCEL_OVERLAPS')
    expect(codes).not.toContain('SLIVERS_INSIDE_REDLINE')
    expect(codes).not.toContain('AREA_PARCELS_OUTSIDE_REDLINE')
    expect(codes).not.toContain('AREA_SUM_MISMATCH')
  })
})

describe('validateBaselineLayersPostgis — redline-level errors', () => {
  it('detects self-intersecting redline', async () => {
    const codes = await runAndGetCodes(
      makeLayers({
        redline: [poly(SELF_INTERSECTING)],
        areas: [poly(SQUARE)]
      })
    )
    expect(codes).toContain('REDLINE_INVALID_GEOMETRY')
  })

  it('detects redline outside England', async () => {
    const codes = await runAndGetCodes(
      makeLayers({
        redline: [poly(OUTSIDE_ENGLAND)],
        areas: [poly(OUTSIDE_ENGLAND)]
      })
    )
    expect(codes).toContain('REDLINE_OUTSIDE_ENGLAND')
  })

  it('detects redline area exceeding the 100 sq km cap', async () => {
    const codes = await runAndGetCodes(
      makeLayers({ redline: [poly(HUGE)], areas: [poly(HUGE)] })
    )
    expect(codes).toContain('REDLINE_AREA_TOO_LARGE')
  })
})

describe('validateBaselineLayersPostgis — habitat parcel errors', () => {
  it('detects parcel overlaps', async () => {
    const codes = await runAndGetCodes(
      makeLayers({
        redline: [poly(BIG)],
        areas: [poly(SQUARE), poly(SQUARE_OFFSET)]
      })
    )
    expect(codes).toContain('PARCEL_OVERLAPS')
  })

  it('detects no-habitat layers', async () => {
    const codes = await runAndGetCodes(makeLayers({ redline: [poly(SQUARE)] }))
    expect(codes).toContain('NO_HABITAT_AREAS')
  })

  it('detects invalid area habitat geometry', async () => {
    const codes = await runAndGetCodes(
      makeLayers({
        redline: [poly(SQUARE)],
        areas: [poly(SELF_INTERSECTING)]
      })
    )
    expect(codes).toContain('AREA_PARCELS_INVALID_GEOMETRY')
  })

  it('detects slivers inside the redline', async () => {
    const codes = await runAndGetCodes(
      makeLayers({
        redline: [poly(SQUARE)],
        areas: [poly(NOTCHED_SQUARE)]
      })
    )
    expect(codes).toContain('SLIVERS_INSIDE_REDLINE')
  })

  it('detects area parcels outside the redline', async () => {
    const codes = await runAndGetCodes(
      makeLayers({
        redline: [poly(SQUARE)],
        areas: [poly(SQUARE_OFFSET)]
      })
    )
    expect(codes).toContain('AREA_PARCELS_OUTSIDE_REDLINE')
  })

  it('detects area sum mismatch', async () => {
    const codes = await runAndGetCodes(
      makeLayers({
        redline: [poly(SQUARE)],
        areas: [poly(HALF_SQUARE)]
      })
    )
    expect(codes).toContain('AREA_SUM_MISMATCH')
  })
})

describe('validateBaselineLayersPostgis — non-area layers outside redline', () => {
  const baseValidLayers = {
    redline: [poly(SQUARE)],
    areas: [poly(SQUARE)]
  }

  it('detects hedgerows outside the redline', async () => {
    const codes = await runAndGetCodes(
      makeLayers({ ...baseValidLayers, hedgerows: [line(LINE_SPANNING)] })
    )
    expect(codes).toContain('HEDGEROWS_OUTSIDE_REDLINE')
  })

  it('detects watercourses outside the redline', async () => {
    const codes = await runAndGetCodes(
      makeLayers({ ...baseValidLayers, watercourses: [line(LINE_SPANNING)] })
    )
    expect(codes).toContain('WATERCOURSES_OUTSIDE_REDLINE')
  })

  it('detects IGGIs outside the redline', async () => {
    const codes = await runAndGetCodes(
      makeLayers({ ...baseValidLayers, iggis: [poly(SQUARE_OFFSET)] })
    )
    expect(codes).toContain('IGGIS_OUTSIDE_REDLINE')
  })

  it('detects trees outside the redline', async () => {
    const codes = await runAndGetCodes(
      makeLayers({ ...baseValidLayers, trees: [point(POINT_OUTSIDE)] })
    )
    expect(codes).toContain('TREES_OUTSIDE_REDLINE')
  })
})
