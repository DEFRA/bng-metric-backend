/**
 * The England reference polygon, pre-projected to EPSG:27700.
 *
 * `reference/england.geojson` is EPSG:4326, and every check in the validator
 * works in EPSG:27700. PostGIS reprojects it inside the statement on every
 * single request (`ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326),
 * 27700)`) — 3,228 coordinate pairs, per upload, forever.
 *
 * That is pure waste, so the projected form is generated once and committed as
 * `england-27700.json`. The committed file is PostGIS's own output, which makes
 * the containment check bit-for-bit comparable with the SQL engine rather than
 * merely close to it. `scripts/gen-england-27700.mjs --check` re-derives it
 * with proj4 and fails if the two have drifted apart, so a future edit to
 * `england.geojson` cannot silently leave this file stale.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))

/** GeoJSON geometry (MultiPolygon) of England in EPSG:27700. */
export const ENGLAND_27700 = Object.freeze(
  JSON.parse(readFileSync(join(moduleDir, 'england-27700.json'), 'utf8'))
)

/** Memoised GEOS pointer — see {@link englandGeometry}. @type {number|null} */
let englandGeom = null

/**
 * The England polygon as a GEOS geometry, built once per thread.
 *
 * Deliberately never freed. It is 3,228 coordinate pairs of constant reference
 * data that every containment check needs; rebuilding it per validation would
 * be the same waste the pre-projection above removes, one level down. A worker
 * holds one for its lifetime, which is a few hundred kilobytes against the few
 * hundred megabytes the WebAssembly heap settles at anyway.
 *
 * @param {import('./geos-runtime.js').GeosRuntime} runtime
 * @returns {number} GEOS geometry pointer — borrowed, do not destroy
 */
export function englandGeometry(runtime) {
  englandGeom ??= runtime.fromGeoJson(ENGLAND_27700)
  return englandGeom
}
