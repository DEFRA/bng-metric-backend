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

describe('validateBaselineLayersPostgis (integration)', () => {
  it('returns no topology errors for redline == single habitat', async () => {
    const layers = {
      redline: [poly(SQUARE)],
      areas: [poly(SQUARE)],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: []
    }
    const result = await validateBaselineLayersPostgis(pool, layers)
    const codes = result.errors.map((e) => e.code)
    expect(codes).not.toContain('REDLINE_INVALID_GEOMETRY')
    expect(codes).not.toContain('AREA_PARCELS_INVALID_GEOMETRY')
    expect(codes).not.toContain('PARCEL_OVERLAPS')
    expect(codes).not.toContain('SLIVERS_OUTSIDE_REDLINE')
    expect(codes).not.toContain('AREA_PARCELS_OUTSIDE_REDLINE')
    expect(codes).not.toContain('AREA_SUM_MISMATCH')
  })

  it('detects self-intersecting redline', async () => {
    const layers = {
      redline: [poly(SELF_INTERSECTING)],
      areas: [poly(SQUARE)],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: []
    }
    const result = await validateBaselineLayersPostgis(pool, layers)
    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('REDLINE_INVALID_GEOMETRY')
  })

  it('detects parcel overlaps', async () => {
    const layers = {
      redline: [poly(BIG)],
      areas: [poly(SQUARE), poly(SQUARE_OFFSET)],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: []
    }
    const result = await validateBaselineLayersPostgis(pool, layers)
    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('PARCEL_OVERLAPS')
  })

  it('detects no-habitat layers', async () => {
    const layers = {
      redline: [poly(SQUARE)],
      areas: [],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: []
    }
    const result = await validateBaselineLayersPostgis(pool, layers)
    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('NO_HABITAT_AREAS')
  })
})
