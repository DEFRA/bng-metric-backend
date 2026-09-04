import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { readGeoPackage } from '../src/validation/geopackage/geopackage.js'
import {
  closeGeosWorkerPool,
  GeosWorkerPool
} from '../src/validation/geopackage/geos/worker-pool.js'

/**
 * Every GeoPackage the project ships, checked against the verdict the PostGIS
 * engine gave it.
 *
 * The service used to run these checks as one large PostGIS statement. That
 * engine has been removed, but its answers have not: before it went,
 * `fixtures/postgis-geometry-verdicts.json` recorded what it said about all 98
 * readable files in the harness's `example-files/` — the valid ones, the
 * deliberately broken ones, the five real BNG-500 submissions, and the whole
 * BMD-934 permutations catalogue.
 *
 * That fixture is the oracle. Nobody designed those files to agree with
 * anything, which is what makes them worth more than fixtures written alongside
 * the code they test: a rule quietly changing meaning shows up here as a
 * verdict that no longer matches what the service used to produce.
 *
 * Runs through the real WORKER POOL rather than inline, so the path a request
 * actually takes — parse on the worker, verdict across the thread boundary — is
 * what gets compared.
 *
 * KNOWN COSMETIC DIFFERENCE. GEOS and PostGIS can emit rotationally different —
 * but geometrically identical — rings for the same overlay result: one may start
 * a triangle at a different vertex. Area, count and verdict are unaffected; only
 * the WKT text in the tail of a message differs. `canonicalise` rotates every
 * ring to a fixed start so that does not read as a failure. Nothing else is
 * relaxed: digits, punctuation and vertex ORDER all still have to match.
 */

const FIXTURE = path.resolve(
  import.meta.dirname,
  'fixtures/postgis-geometry-verdicts.json'
)

/** Round floats to a millionth — a micron, or a square micron. */
const COMPARISON_DECIMAL_PLACES = 6

/** Generous: these run in parallel and the corpus includes real submissions. */
const POOL_TIMEOUT_MS = 120_000

const { _meta, verdicts } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

/** Name in the harness repo's package.json, used to identify it by content. */
const HARNESS_PACKAGE_NAME = 'bng-metric-harness'

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
 * `example-files/` lives in the harness repo beside this one. The directory
 * NAME is a developer's choice, and more than one sibling ships an
 * `example-files/` of its own, so the harness is identified by its package.json.
 * Returns null when there is no harness beside us and the suite skips: a
 * checkout of this repo alone should not fail for want of it.
 */
function findExampleFilesDir() {
  if (process.env.EXAMPLE_FILES_DIR) {
    return process.env.EXAMPLE_FILES_DIR
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
 * A comparable form of a verdict: object key order dropped (PostgreSQL returned
 * jsonb keys in its own order), floats rounded, WKT rings rotated to a fixed
 * start.
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
  if (typeof value === 'string' && (WKT_FIELDS.has(key) || key === 'message')) {
    return canonicaliseWkt(value)
  }
  return value
}

const comparable = (result) =>
  canonicalise({
    valid: result.valid,
    errors: result.errors.map((error) => ({
      code: error.code,
      message: error.message,
      details: error.details ?? null
    }))
  })

const pool = new GeosWorkerPool({
  size: 2,
  queueLimit: 1000,
  timeoutMs: POOL_TIMEOUT_MS
})

afterAll(async () => {
  await pool.close()
  await closeGeosWorkerPool()
})

const CASES = Object.entries(verdicts).map(([relativePath, verdict]) => [
  relativePath,
  verdict
])

describe('geometry verdicts match what the PostGIS engine produced', () => {
  it('the recorded oracle covers the corpus it claims to', () => {
    expect(_meta.recordedFrom).toBe(
      'src/validation/geopackage/postgis/index.js'
    )
    expect(CASES).toHaveLength(_meta.fileCount)
    // A fixture that had quietly become all-accepts would pass every assertion
    // below while proving nothing.
    expect(CASES.filter(([, v]) => !v.valid).length).toBeGreaterThan(20)
  })

  describe.skipIf(!EXAMPLE_FILES_DIR)('per file', () => {
    it.each(CASES)('%s', async (relativePath, expected) => {
      const file = path.join(EXAMPLE_FILES_DIR, relativePath)
      // The fixture was recorded from files that parse; one that no longer does
      // is a change to the corpus, not to the validator.
      expect(fs.existsSync(file)).toBe(true)
      readGeoPackage(file)

      const actual = await pool.run(file)

      expect(comparable(actual)).toEqual(comparable(expected))
    })
  })
})
