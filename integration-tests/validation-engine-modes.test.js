import { afterAll, afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

import { config } from '../src/config.js'
import { validateGeoPackageLayers } from '../src/validation/geopackage/index.js'
import { readGeoPackage } from '../src/validation/geopackage/geopackage.js'
import { closeGeosWorkerPool } from '../src/validation/geopackage/geos/worker-pool.js'
import { getDbConfig } from './helpers/db.js'

/**
 * The three engine modes, driven through the real seam, against a real file, a
 * real worker pool and a real database.
 *
 * The unit tests in `src/validation/geopackage/engine.test.js` cover the
 * dispatch logic with the pool mocked out. This covers the wiring those mocks
 * stand in for: that a file path really does reach a worker thread, that the
 * verdict really does come back across the boundary, and that the sizes the
 * worker measured are the ones the sizing pass would otherwise have asked
 * PostGIS for.
 */

const pool = new pg.Pool(getDbConfig())

/** Same resolution as the parity suite — see the note there. */
function findExampleFile() {
  const parent = path.resolve('..')
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    const candidate = path.join(
      parent,
      entry.name,
      'example-files',
      'valid',
      'Baseline - complete with area refs.gpkg'
    )
    if (entry.isDirectory() && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

const FILE = findExampleFile()

afterEach(() => {
  config.set('validation.engine', 'postgis')
})

afterAll(async () => {
  await closeGeosWorkerPool()
  await pool.end().catch(() => {})
})

describe.skipIf(!FILE)('validation engine modes, end to end', () => {
  it('accepts the file on the PostGIS engine', async () => {
    config.set('validation.engine', 'postgis')
    const result = await validateGeoPackageLayers(
      readGeoPackage(FILE),
      pool,
      'baseline',
      { filePath: FILE }
    )
    expect(result.valid).toBe(true)
    expect(result.sizes).toBeUndefined()
  })

  it('reaches the same verdict on the GEOS engine, via a worker thread', async () => {
    config.set('validation.engine', 'geos')
    const result = await validateGeoPackageLayers(
      readGeoPackage(FILE),
      pool,
      'baseline',
      { filePath: FILE }
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('returns per-feature sizes from the worker when asked for them', async () => {
    config.set('validation.engine', 'geos')
    const layers = readGeoPackage(FILE)
    const result = await validateGeoPackageLayers(layers, pool, 'baseline', {
      filePath: FILE,
      includeSizes: true
    })
    expect(result.sizes.areas).toHaveLength(layers.areas.length)
    for (const { idx, value } of result.sizes.areas) {
      expect(Number.isInteger(idx)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('measures the same areas the PostGIS sizing query would have', async () => {
    config.set('validation.engine', 'geos')
    const layers = readGeoPackage(FILE)
    const { sizes } = await validateGeoPackageLayers(layers, pool, 'baseline', {
      filePath: FILE,
      includeSizes: true
    })
    const { rows } = await pool.query(
      `SELECT ST_Area(ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), 27700))) AS area
       FROM unnest($1::text[], $2::int[]) AS t(g, srid)`,
      [
        layers.areas.map((f) => f.geometryJson),
        layers.areas.map((f) => f.nativeSrid)
      ]
    )
    sizes.areas.forEach(({ idx, value }) => {
      expect(value).toBeCloseTo(Number(rows[idx].area), 6)
    })
  })

  it('falls back to PostGIS when the GEOS engine has no file to give a worker', async () => {
    config.set('validation.engine', 'geos')
    const result = await validateGeoPackageLayers(
      readGeoPackage(FILE),
      pool,
      'baseline'
    )
    expect(result.valid).toBe(true)
    expect(result.sizes).toBeUndefined()
  })

  it('returns the PostGIS answer in shadow mode, and asks for no sizes', async () => {
    config.set('validation.engine', 'shadow')
    const result = await validateGeoPackageLayers(
      readGeoPackage(FILE),
      pool,
      'baseline',
      { filePath: FILE, includeSizes: true }
    )
    expect(result.valid).toBe(true)
    expect(result.sizes).toBeUndefined()
  })
})
