import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

import { validateGeoPackageLayersPostgis } from '../src/validation/geopackage/postgis/index.js'
import { validateGeoPackageLayersGeos } from '../src/validation/geopackage/geos/index.js'
import { readGeoPackage } from '../src/validation/geopackage/geopackage.js'
import { getDbConfig } from './helpers/db.js'

/**
 * Parity between the two geometry-validation engines.
 *
 * The PostGIS statement and the in-process GEOS checks must reach the same
 * verdict, with the same payloads, on the same file. This suite is the
 * instrument that proves it, and it is the reason the GEOS engine can be
 * switched on at all: it does not assert what the *right* answer is, it asserts
 * that the two engines give the *same* answer — on hand-built edge cases here,
 * and on every real GeoPackage in `example-files/` below.
 *
 * `postgis-validate-baseline-layers.test.js` remains the suite that pins what
 * the right answer is, and stays PostGIS-only: its last describe block asserts
 * EXPLAIN plans and temp-table lifetimes, which have no counterpart in an
 * engine with no database.
 *
 * KNOWN COSMETIC DIVERGENCE. The two libraries can emit rotationally different
 * — but geometrically identical — rings for the same overlay result: PostGIS
 * might start a triangle at one vertex where GEOS starts at another. The area,
 * the count and the verdict are unaffected; only the WKT text in the tail of an
 * error message differs. `canonicalise` below rotates every ring to a canonical
 * start so that difference does not read as a failure, and nothing else about
 * the WKT is relaxed: digits, punctuation and vertex order all still have to
 * match exactly.
 */

const BNG_SRID = 27_700
const X0 = 530_000
const Y0 = 180_000
const EDGE = 100
const HALF = EDGE / 2

/** Round floats to a millionth before comparing — 1 micron, or 1 sq micron. */
const COMPARISON_DECIMAL_PLACES = 6

const pool = new pg.Pool(getDbConfig())

afterAll(async () => {
  await pool.end().catch(() => {})
})

const ENGINES = {
  postgis: (layers) => validateGeoPackageLayersPostgis(pool, layers),
  geos: (layers) => validateGeoPackageLayersGeos(layers)
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Rotate a closed ring's vertices so it starts at its smallest vertex. */
function rotateRing(ring) {
  const closed = ring.at(0) === ring.at(-1)
  const cycle = closed ? ring.slice(0, -1) : ring
  let start = 0
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[start]) {
      start = i
    }
  }
  const rotated = [...cycle.slice(start), ...cycle.slice(0, start)]
  return closed ? [...rotated, rotated[0]] : rotated
}

/**
 * Rewrite every coordinate list inside a WKT string so rotationally equivalent
 * rings compare equal. Operates on the innermost parenthesised groups, which is
 * exactly what a ring is in POLYGON / MULTIPOLYGON WKT.
 */
function canonicaliseWkt(wkt) {
  return wkt.replaceAll(/\(([^()]+)\)/g, (_, body) =>
    body.includes(',')
      ? `(${rotateRing(body.split(',')).join(',')})`
      : `(${body})`
  )
}

const WKT_FIELDS = new Set(['location_wkt', 'escape_location_wkt'])

/**
 * A comparable form of an engine's result: object key order dropped (jsonb
 * reorders keys, JS does not), floats rounded, WKT rings rotated to a canonical
 * start, and the engine-specific `geosVersion` field removed.
 */
function canonicalise(value, key) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalise(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((name) => [name, canonicalise(value[name], name)])
    )
  }
  if (typeof value === 'number') {
    return Number(value.toFixed(COMPARISON_DECIMAL_PLACES))
  }
  if (typeof value === 'string') {
    return WKT_FIELDS.has(key) || key === 'message'
      ? canonicaliseWkt(value)
      : value
  }
  return value
}

/** Run both engines over `layers` and return their canonicalised results. */
async function bothEngines(layers) {
  const postgis = await ENGINES.postgis(layers)
  const geos = await ENGINES.geos(layers)
  return {
    postgis: canonicalise({ valid: postgis.valid, errors: postgis.errors }),
    geos: canonicalise({ valid: geos.valid, errors: geos.errors }),
    codes: postgis.errors.map((error) => error.code)
  }
}

// ---------------------------------------------------------------------------
// Fixtures — the same shapes postgis-validate-baseline-layers.test.js uses
// ---------------------------------------------------------------------------

function ring(x = X0, y = Y0, edge = EDGE) {
  return [
    [x, y],
    [x + edge, y],
    [x + edge, y + edge],
    [x, y + edge],
    [x, y]
  ]
}

function feature(geometry, properties, srid = BNG_SRID) {
  return {
    type: 'Feature',
    properties,
    geometry,
    nativeGeometry: geometry,
    nativeSrid: srid
  }
}

const poly = (coordinates, properties = {}, srid = BNG_SRID) =>
  feature({ type: 'Polygon', coordinates: [coordinates] }, properties, srid)
const lineString = (coordinates, properties = {}) =>
  feature({ type: 'LineString', coordinates }, properties)
const pointAt = (coordinates, properties = {}) =>
  feature({ type: 'Point', coordinates }, properties)

const SELF_INTERSECTING = [
  [X0, Y0],
  [X0 + EDGE, Y0 + EDGE],
  [X0 + EDGE, Y0],
  [X0, Y0 + EDGE],
  [X0, Y0]
]

const SCOTLAND = ring(300_000, 700_000, EDGE)
const HUGE = ring(X0, Y0, 11_000)
const WGS84_RING = [
  [-0.105, 51.515],
  [-0.104, 51.515],
  [-0.104, 51.516],
  [-0.105, 51.516],
  [-0.105, 51.515]
]

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

/**
 * Every scenario runs through both engines. `codes` pins what the answer should
 * be, so "both engines agree, and both are wrong" cannot pass silently.
 */
const SCENARIOS = [
  {
    name: 'redline exactly filled by one parcel',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1, 'Parcel Ref': 'H001' })]
    }),
    codes: []
  },
  {
    name: 'redline tiled by four parcels sharing edges',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [
        poly(ring(X0, Y0, HALF), { fid: 1 }),
        poly(ring(X0 + HALF, Y0, HALF), { fid: 2 }),
        poly(ring(X0, Y0 + HALF, HALF), { fid: 3 }),
        poly(ring(X0 + HALF, Y0 + HALF, HALF), { fid: 4 })
      ]
    }),
    codes: []
  },
  {
    name: 'no redline at all',
    layers: makeLayers({ areas: [poly(ring())] }),
    codes: ['NO_REDLINE']
  },
  {
    name: 'no habitat parcels at all',
    layers: makeLayers({ redline: [poly(ring())] }),
    codes: ['NO_HABITAT_AREAS']
  },
  {
    name: 'entirely empty file',
    layers: makeLayers(),
    codes: ['NO_REDLINE', 'NO_HABITAT_AREAS']
  },
  {
    name: 'self-intersecting redline',
    layers: makeLayers({
      redline: [poly(SELF_INTERSECTING)],
      areas: [poly(ring(), { fid: 1, 'Parcel Ref': 'H001' })]
    }),
    codes: [
      'REDLINE_INVALID_GEOMETRY',
      'SLIVERS_OUTSIDE_REDLINE',
      'AREA_PARCELS_OUTSIDE_REDLINE',
      'AREA_SUM_MISMATCH'
    ]
  },
  {
    name: 'redline outside England',
    layers: makeLayers({
      redline: [poly(SCOTLAND)],
      areas: [poly(SCOTLAND, { fid: 1 })]
    }),
    codes: ['REDLINE_OUTSIDE_ENGLAND']
  },
  {
    name: 'redline over the 100 sq km cap',
    layers: makeLayers({
      redline: [poly(HUGE)],
      areas: [poly(HUGE, { fid: 1 })]
    }),
    // An 11 km square from central London reaches past the reference coastline,
    // so both engines report the containment failure alongside the cap.
    codes: ['REDLINE_OUTSIDE_ENGLAND', 'REDLINE_AREA_TOO_LARGE']
  },
  {
    name: 'invalid area habitat geometry',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(SELF_INTERSECTING, { fid: 1, 'Parcel Ref': 'H001' })]
    }),
    codes: ['AREA_PARCELS_INVALID_GEOMETRY', 'AREA_SUM_MISMATCH']
  },
  {
    name: 'overlapping parcels',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [
        poly(ring(), { fid: 1, 'Parcel Ref': 'A' }),
        poly(ring(X0 + HALF, Y0 + HALF), { fid: 2, 'Parcel Ref': 'B' })
      ]
    }),
    codes: [
      'PARCEL_OVERLAPS',
      'SLIVERS_OUTSIDE_REDLINE',
      'AREA_PARCELS_OUTSIDE_REDLINE',
      'AREA_SUM_MISMATCH'
    ]
  },
  {
    name: 'overlap between a self-intersecting parcel and a valid neighbour',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [
        poly(SELF_INTERSECTING, { fid: 1 }),
        poly(ring(X0 + 10, Y0 + 60, 30), { fid: 2 })
      ]
    }),
    codes: [
      'AREA_PARCELS_INVALID_GEOMETRY',
      'PARCEL_OVERLAPS',
      'AREA_SUM_MISMATCH'
    ]
  },
  {
    name: 'parcel under the 1 sq m minimum',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [
        poly(ring(), { fid: 1 }),
        poly(ring(X0 + 10, Y0 + 10, 0.9), { fid: 2, 'Parcel Ref': 'H002' })
      ]
    }),
    codes: ['PARCEL_OVERLAPS', 'AREA_PARCELS_TOO_SMALL', 'AREA_SUM_MISMATCH']
  },
  {
    name: 'parcel escaping the redline',
    layers: makeLayers({
      redline: [poly(ring(X0, Y0, EDGE))],
      areas: [poly(ring(X0, Y0, EDGE * 2), { fid: 1, 'Parcel Ref': 'H001' })]
    }),
    codes: [
      'SLIVERS_OUTSIDE_REDLINE',
      'AREA_PARCELS_OUTSIDE_REDLINE',
      'AREA_SUM_MISMATCH'
    ]
  },
  {
    name: 'hedgerow escaping the redline by 50 cm',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1 })],
      hedgerows: [
        lineString(
          [
            [X0 + 10, Y0 + 10],
            [X0 + EDGE + 0.5, Y0 + 10]
          ],
          { fid: 1, 'Parcel Ref': 'HE1' }
        )
      ]
    }),
    codes: ['HEDGEROWS_OUTSIDE_REDLINE']
  },
  {
    name: 'hedgerow escaping the redline by 5 cm — under tolerance',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1 })],
      hedgerows: [
        lineString([
          [X0 + 10, Y0 + 10],
          [X0 + EDGE + 0.05, Y0 + 10]
        ])
      ]
    }),
    codes: []
  },
  {
    name: 'watercourse escaping the redline by 50 cm',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1 })],
      watercourses: [
        lineString(
          [
            [X0 + 10, Y0 + 10],
            [X0 + EDGE + 0.5, Y0 + 10]
          ],
          { fid: 7 }
        )
      ]
    }),
    codes: ['WATERCOURSES_OUTSIDE_REDLINE']
  },
  {
    name: 'IGGI outside the redline',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1 })],
      iggis: [poly(ring(X0 + 200, Y0 + 200, EDGE), { fid: 3 })]
    }),
    codes: ['IGGIS_OUTSIDE_REDLINE']
  },
  {
    name: 'IGGI sharing an edge with the redline',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1 })],
      iggis: [poly(ring(X0, Y0, HALF), { fid: 3 })]
    }),
    codes: []
  },
  {
    name: 'tree outside the redline',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1 })],
      trees: [pointAt([X0 - EDGE, Y0 - EDGE], { fid: 2, 'Tree Ref': 'T002' })]
    }),
    codes: ['TREES_OUTSIDE_REDLINE']
  },
  {
    name: 'tree exactly on the redline edge',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(), { fid: 1 })],
      trees: [pointAt([X0 + EDGE, Y0 + HALF], { fid: 2 })]
    }),
    codes: []
  },
  {
    name: 'area sum mismatch',
    layers: makeLayers({
      redline: [poly(ring(X0, Y0, EDGE))],
      areas: [poly(ring(X0, Y0, HALF), { fid: 1 })]
    }),
    // The quarter-size parcel sits wholly inside the redline, so the only
    // complaint is that it does not cover it.
    codes: ['AREA_SUM_MISMATCH']
  },
  {
    name: 'EPSG:4326 input, reprojected by each engine its own way',
    layers: makeLayers({
      redline: [poly(WGS84_RING, {}, 4326)],
      areas: [poly(WGS84_RING, { fid: 1 }, 4326)]
    }),
    codes: []
  },
  {
    name: 'features with no reference column, falling back to fid',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [
        poly(ring(), { fid: 11 }),
        poly(ring(X0 + HALF, Y0 + HALF), { fid: 12 })
      ]
    }),
    codes: [
      'PARCEL_OVERLAPS',
      'SLIVERS_OUTSIDE_REDLINE',
      'AREA_PARCELS_OUTSIDE_REDLINE',
      'AREA_SUM_MISMATCH'
    ]
  },
  {
    name: 'a parcel carrying neither ref nor fid, falling back to position',
    layers: makeLayers({
      redline: [poly(ring())],
      areas: [poly(ring(X0 + 200, Y0 + 200, EDGE), {})]
    }),
    // Same area as the redline, just entirely in the wrong place — so the sum
    // check is satisfied while every containment check is not.
    codes: ['SLIVERS_OUTSIDE_REDLINE', 'AREA_PARCELS_OUTSIDE_REDLINE']
  }
]

describe('validation engines — parity over hand-built scenarios', () => {
  it.each(SCENARIOS)('$name', async ({ layers, codes }) => {
    const result = await bothEngines(layers)
    expect(result.codes).toEqual(codes)
    expect(result.geos).toEqual(result.postgis)
  })
})

// ---------------------------------------------------------------------------
// The real corpus
// ---------------------------------------------------------------------------

/** Name in the harness repo's package.json, used to identify it by content. */
const HARNESS_PACKAGE_NAME = 'bng-metric-harness'

/** True when `dir` is the harness checkout, whatever it has been renamed to. */
function isHarnessCheckout(dir) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    )
    return manifest.name === HARNESS_PACKAGE_NAME
  } catch {
    return false
  }
}

/**
 * `example-files/` lives in the harness repo, checked out beside this one. The
 * directory NAME is a developer's choice, and more than one sibling ships an
 * `example-files/` of its own (the prototype has nine of them), so the harness
 * is identified by its package.json rather than by where it happens to sit.
 *
 * Returns null when there is no harness beside us, and the corpus block skips:
 * it is a bonus over the hand-built scenarios above, not a prerequisite, and a
 * CI checkout of this repo alone should not fail for want of it.
 */
function findExampleFilesDir() {
  const override = process.env.EXAMPLE_FILES_DIR
  if (override) {
    return override
  }
  const parent = path.resolve('..')
  const harness = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name))
    .find(isHarnessCheckout)
  return harness ? path.join(harness, 'example-files') : null
}

const EXAMPLE_FILES_DIR = findExampleFilesDir()

/** Every .gpkg under example-files/, relative path first for a readable name. */
function exampleFiles(root) {
  if (!root || !fs.existsSync(root)) {
    return []
  }
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.gpkg')) {
        found.push([path.relative(root, full), full])
      }
    }
  }
  walk(root)
  return found.sort(([a], [b]) => a.localeCompare(b))
}

const CORPUS = exampleFiles(EXAMPLE_FILES_DIR)

/**
 * The scenarios above are shapes someone thought to write down. This is every
 * GeoPackage the project actually ships — valid files, deliberately broken
 * ones, the five real BNG-500 submissions, and the whole BMD-934 permutations
 * catalogue. It is the part of this suite that retires the "numerical
 * divergence from PostGIS" risk, because nobody designed these to agree.
 */
describe.skipIf(CORPUS.length === 0)(
  'validation engines — parity over every example GeoPackage',
  () => {
    it.each(CORPUS)('%s', async (_name, file) => {
      let layers
      try {
        layers = readGeoPackage(file)
      } catch {
        // Files the format gate rejects before any shape is unpacked never
        // reach either engine, so they have no parity to assert.
        return
      }
      const result = await bothEngines(layers)
      expect(result.geos).toEqual(result.postgis)
    })
  }
)
