#!/usr/bin/env node
/**
 * Generate — or check — the pre-projected England reference polygon the GEOS
 * validation engine uses.
 *
 * `src/validation/reference/england.geojson` is EPSG:4326. Every geometry check
 * runs in EPSG:27700, so the PostGIS engine reprojects the polygon inside the
 * statement on every request. The GEOS engine reads the projected form from
 * `src/validation/geopackage/geos/england-27700.json` instead, which costs
 * nothing per request but has to be kept in step with its source.
 *
 * Usage:
 *   node scripts/gen-england-27700.mjs           # rewrite the projected file
 *   node scripts/gen-england-27700.mjs --check   # fail if it has drifted (CI)
 *
 * The committed file was produced by PostGIS (`ST_Transform`), deliberately: it
 * makes the England containment check bit-comparable between the two engines.
 * This script re-derives it with proj4js, which is not bit-identical to PROJ —
 * measured worst case 0.00075 m — so `--check` compares within a tolerance
 * rather than by string equality. A drift larger than that means the source
 * GeoJSON changed and the projected file needs regenerating.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { toBritishNationalGrid } from '../src/validation/geopackage/geos/reproject.js'
import { EPSG_WGS84 } from '../src/validation/geopackage/geopackage-constants.js'

/**
 * Largest per-coordinate disagreement tolerated between proj4js and the
 * committed PostGIS output, in metres. The measured worst case across England
 * is 0.00075 m; 0.01 m leaves an order of magnitude of headroom while still
 * being a thousand times finer than the validator's tightest tolerance.
 */
const DRIFT_TOLERANCE_M = 0.01

const scriptDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(
  scriptDir,
  '..',
  'src',
  'validation',
  'reference',
  'england.geojson'
)
const targetPath = join(
  scriptDir,
  '..',
  'src',
  'validation',
  'geopackage',
  'geos',
  'england-27700.json'
)

/** Flatten a GeoJSON coordinate tree into a flat list of positions. */
function positions(coordinates, into = []) {
  if (typeof coordinates[0] === 'number') {
    into.push(coordinates)
    return into
  }
  for (const child of coordinates) {
    positions(child, into)
  }
  return into
}

/**
 * Largest distance between corresponding positions of two same-shaped
 * geometries, in metres. Returns Infinity when the shapes do not correspond.
 */
function worstDrift(left, right) {
  const a = positions(left.coordinates)
  const b = positions(right.coordinates)
  if (left.type !== right.type || a.length !== b.length) {
    return Infinity
  }
  let worst = 0
  for (let i = 0; i < a.length; i++) {
    const drift = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
    if (drift > worst) {
      worst = drift
    }
  }
  return worst
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
const projected = toBritishNationalGrid(source.geometry, EPSG_WGS84)

if (process.argv.includes('--check')) {
  const committed = JSON.parse(readFileSync(targetPath, 'utf8'))
  const drift = worstDrift(committed, projected)
  if (drift > DRIFT_TOLERANCE_M) {
    console.error(
      `england-27700.json is stale: worst drift from england.geojson is ` +
        `${Number.isFinite(drift) ? `${drift.toFixed(4)} m` : 'a shape mismatch'}, ` +
        `over the ${DRIFT_TOLERANCE_M} m tolerance.\n` +
        `Regenerate it with: node scripts/gen-england-27700.mjs`
    )
    process.exit(1)
  }
  console.log(
    `england-27700.json is in step with england.geojson (worst drift ${drift.toExponential(2)} m)`
  )
} else {
  writeFileSync(targetPath, JSON.stringify(projected))
  console.log(
    `${targetPath} written — ${positions(projected.coordinates).length} positions`
  )
}
