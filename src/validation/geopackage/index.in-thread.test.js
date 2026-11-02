import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from './errors.js'
import { readGeoPackage } from './geopackage.js'
import { getGeosWorkerPool } from './geos/worker-pool.js'
import { validateGeoPackageLayers } from './index.js'
import { FEATURE_READ_MODE } from './read-feature-tables.js'

vi.mock('./geos/worker-pool.js', () => ({ getGeosWorkerPool: vi.fn() }))

const scratch = mkdtempSync(path.join(tmpdir(), 'in-thread-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../integration-tests/fixtures/baseline-complete.gpkg'
)

/**
 * A copy of the fixture with a geometry failure and a data-quality failure:
 * its second habitat drawn over its first, and its third with no ref.
 */
function brokenCopy() {
  const file = path.join(scratch, 'broken.gpkg')
  copyFileSync(FIXTURE, file)
  const db = new Database(file)
  try {
    // The R-tree triggers call spatial functions plain SQLite lacks; the
    // checks never read the index.
    const triggers = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'rtree_Habitats_%'`
      )
      .all()
    for (const { name } of triggers) {
      db.exec(`DROP TRIGGER "${name}"`)
    }
    const [first, second, third] = db
      .prepare('SELECT fid FROM Habitats ORDER BY fid')
      .all()
      .map((row) => row.fid)
    db.prepare(
      'UPDATE Habitats SET geom = (SELECT geom FROM Habitats WHERE fid = ?) WHERE fid = ?'
    ).run(first, second)
    db.prepare(`UPDATE Habitats SET "Parcel Ref" = '' WHERE fid = ?`).run(third)
  } finally {
    db.close()
  }
  return file
}

// `inThread` is for a caller with no pool to queue behind: importUploadFile,
// which the metric comparison in bng-metric-harness calls.
describe('validateGeoPackageLayers in thread', () => {
  it('runs the geometry checks without the worker pool', async () => {
    const result = await validateGeoPackageLayers(
      () => readGeoPackage(FIXTURE, FEATURE_READ_MODE.properties),
      'baseline',
      { filePath: FIXTURE, includeSizes: true, inThread: true }
    )

    expect(getGeosWorkerPool).not.toHaveBeenCalled()
    expect(result).toMatchObject({ valid: true, errors: [] })
    expect(result.sizes.areas.length).toBeGreaterThan(0)
    expect(result.poolTelemetry).toBeUndefined()
  })

  it('keeps the geometry errors, after the data-quality ones', async () => {
    const file = brokenCopy()

    const result = await validateGeoPackageLayers(
      () => readGeoPackage(file, FEATURE_READ_MODE.properties),
      'baseline',
      { filePath: file, inThread: true }
    )

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.HABITAT_REF_MISSING,
      ERROR_CODES.PARCEL_OVERLAPS,
      ERROR_CODES.AREA_SUM_MISMATCH
    ])
  })
})
