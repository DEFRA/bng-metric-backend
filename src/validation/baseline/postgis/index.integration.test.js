import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'

import { validateBaselineLayersPostgis } from './index.js'

// Integration test: requires the local Postgres (compose.yml) with the PostGIS
// extension installed. Skips itself when PG is unreachable so CI without a
// database doesn't fail.

const PG_CONFIG = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'dev',
  password: process.env.DB_LOCAL_PASSWORD ?? 'dev',
  database: process.env.DB_DATABASE ?? 'bng_metric_backend',
  connectionTimeoutMillis: 1500
}

const pool = new pg.Pool(PG_CONFIG)
let pgAvailable = false
try {
  // PostGIS is assumed to be pre-installed in every environment (managed by
  // the platform team in CDP, by the postgis/postgis Docker image locally).
  await pool.query("SELECT extname FROM pg_extension WHERE extname = 'postgis'")
  pgAvailable = true
} catch (err) {
  console.warn(
    `[postgis integration] skipping — pg unavailable: ${err.code ?? err.message ?? err}`
  )
  pgAvailable = false
}

afterAll(async () => {
  await pool.end().catch(() => {})
})

function poly(ring, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [ring] },
    nativeGeometry: { type: 'Polygon', coordinates: [ring] },
    nativeSrid: 27700
  }
}

// EPSG:27700 metres around central London.
const SQUARE = [
  [530000, 180000],
  [530100, 180000],
  [530100, 180100],
  [530000, 180100],
  [530000, 180000]
]

const SQUARE_OFFSET = [
  [530050, 180050],
  [530150, 180050],
  [530150, 180150],
  [530050, 180150],
  [530050, 180050]
]

const SELF_INTERSECTING = [
  [530000, 180000],
  [530100, 180100],
  [530100, 180000],
  [530000, 180100],
  [530000, 180000]
]

describe.skipIf(!pgAvailable)(
  'validateBaselineLayersPostgis (integration)',
  () => {
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
      expect(codes).not.toContain('REDLINE_SELF_INTERSECTING')
      expect(codes).not.toContain('AREA_PARCELS_SELF_INTERSECTING')
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
      expect(codes).toContain('REDLINE_SELF_INTERSECTING')
    })

    it('detects parcel overlaps', async () => {
      const big = [
        [529900, 179900],
        [530200, 179900],
        [530200, 180200],
        [529900, 180200],
        [529900, 179900]
      ]
      const layers = {
        redline: [poly(big)],
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
  }
)
