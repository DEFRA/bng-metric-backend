// The staged GeoPackage path as the upload routes actually run it: format gate,
// then readStagedGeoPackage → deriveLineage → reconcileSize, surfaced as the
// same `{ valid, errors }` the single-stage path returns.
//
// staged-lineage.test.js proves the individual lineage modules against the same
// fixture. This file proves they are wired together and reachable from
// POST /baseline/validate.
//
// The negative cases mutate a throwaway copy of the fixture rather than adding
// more binary files to the repo — a corrupted-on-purpose GeoPackage is only
// meaningful next to the one it was corrupted from.

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { gpkgPolygon } from 'bng-library/gpkg-io'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

import { ERROR_CODES } from '../src/validation/geopackage/errors.js'
import { EPSG_BNG } from '../src/validation/geopackage/geopackage-constants.js'
import { validateStagedGeoPackage } from '../src/validation/geopackage/lineage/validate-staged-geopackage.js'
import { getDbConfig } from './helpers/db.js'
import { startServer, stopServer } from './helpers/server.js'
import {
  assertCdpUploaderReachable,
  assertLocalStackPipelineReady,
  uploadViaCdpUploader,
  waitForUploadStatus
} from './helpers/upload-fixtures.js'
import { authHeaders, mintToken } from './helpers/auth-tokens.js'

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'staged-baseline-and-pi.gpkg'
)

const HTTP_OK = 200
const BUCKET = 'baseline-files'
const HEDGE_HALF_M = 100

/**
 * PI parcel PR-1, shifted 10 m west. Translation preserves its area, so the
 * totals still reconcile and containment is the only thing that fails — which
 * is what makes the assertion below about containment specifically.
 * The strip from x=-10 to x=0 is the 1000 sq m that escapes parent PR-1.
 */
const SHIFTED_PR1_RING = [
  [90, 0],
  [-10, 0],
  [-10, 100],
  [90, 100],
  [90, 75],
  [65, 75],
  [65, 25],
  [90, 25],
  [90, 0]
]
const SHIFTED_PR1_ESCAPE_SQ_M = 1000

const pool = new pg.Pool(getDbConfig())

/**
 * @param {import('better-sqlite3').Database} db
 */
function dropTriggers(db) {
  const triggers = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
    .all()
  for (const { name } of triggers) {
    db.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`)
  }
}

/**
 * Copy the fixture somewhere disposable, break it in one specific way, and run
 * the validator over the result.
 *
 * @param {(db: import('better-sqlite3').Database) => void} mutate
 * @returns {Promise<{ valid: boolean, errors: Array<{ code: string, message: string, details?: object }> }>}
 */
async function validateMutatedFixture(mutate) {
  const dir = mkdtempSync(path.join(tmpdir(), 'staged-gpkg-'))
  const filePath = path.join(dir, 'staged.gpkg')
  copyFileSync(FIXTURE, filePath)
  const db = new Database(filePath)
  try {
    // QGIS writes RTree maintenance triggers that call SpatiaLite functions
    // (ST_IsEmpty), which plain SQLite does not have — any UPDATE on a feature
    // table fails without dropping them. Foreign keys go the same way so a
    // layer can be unregistered from gpkg_contents. Both only affect this
    // throwaway copy; the real file is never opened for writing.
    dropTriggers(db)
    db.pragma('foreign_keys = OFF')
    mutate(db)
  } finally {
    db.close()
  }
  try {
    return await validateStagedGeoPackage(filePath, pool)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function errorFor(result, code) {
  return result.errors.find((error) => error.code === code)
}

afterAll(async () => {
  await pool.end().catch(() => {})
})

describe('validateStagedGeoPackage', () => {
  it('accepts a clean export from the template', async () => {
    const result = await validateStagedGeoPackage(FIXTURE, pool)

    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('rejects a stamped parent that names nothing in the baseline', async () => {
    // Left unreported this degrades quietly: deriveLineage falls through to the
    // geometry rule and the parcel picks up a plausible parent it never had.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `UPDATE "Habitats Post-Intervention" SET "Parent Ref" = 'GONE' WHERE "PI Ref" = 'PR-1'`
      ).run()
    })

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_UNKNOWN_PARENT_REF)
    expect(error.details.count).toBe(1)
    expect(error.details.sample[0]).toMatchObject({
      type: 'areas',
      pi_ref: 'PR-1',
      parent_ref: 'GONE'
    })
  })

  it('rejects a post-intervention layer whose baseline layer is absent', async () => {
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `DELETE FROM gpkg_geometry_columns WHERE table_name = 'Hedgerows Baseline'`
      ).run()
      db.prepare(
        `DELETE FROM gpkg_contents WHERE table_name = 'Hedgerows Baseline'`
      ).run()
    })

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_MISSING_BASELINE_LAYER)
    expect(error.details.sample).toEqual([{ type: 'hedgerows' }])
  })

  it('rejects totals that no longer balance', async () => {
    // Deleting the `Lost` half of the split hedgerow is the exact scenario the
    // "Lost rows count towards the totals" decision exists for: the ground is
    // still accounted for, so removing the row opens a 100 m hole.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `DELETE FROM "Hedgerows Post-Intervention" WHERE "Retention Category" = 'Lost'`
      ).run()
    })

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_SIZE_MISMATCH)
    expect(error.details.sample[0]).toMatchObject({
      type: 'hedgerows',
      measure: 'length'
    })
    expect(error.details.sample[0].delta).toBeCloseTo(HEDGE_HALF_M, 1)
  })

  it('rejects a parcel that has strayed outside its stamped parent', async () => {
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `UPDATE "Habitats Post-Intervention" SET geom = ? WHERE "PI Ref" = 'PR-1'`
      ).run(gpkgPolygon(EPSG_BNG, SHIFTED_PR1_RING))
    })

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_PI_OUTSIDE_PARENT)
    expect(error.details.sample[0]).toMatchObject({
      type: 'areas',
      pi_ref: 'PR-1',
      parent_ref: 'PR-1',
      measure: 'area'
    })
    expect(error.details.sample[0].escape_size).toBeCloseTo(
      SHIFTED_PR1_ESCAPE_SQ_M,
      1
    )
  })

  it('leaves watercourses alone — realignment is not a mismatch', async () => {
    // The re-meandered channel is longer than the baseline one. If the
    // exemption ever stopped being honoured this is the test that notices.
    const result = await validateStagedGeoPackage(FIXTURE, pool)
    const mismatch = errorFor(result, ERROR_CODES.STAGED_SIZE_MISMATCH)

    expect(mismatch).toBeUndefined()
  })
})

describe('POST /baseline/validate/{uploadId} with a staged GeoPackage', () => {
  let server
  let headers

  beforeAll(async () => {
    await assertCdpUploaderReachable()
    await assertLocalStackPipelineReady()
    server = await startServer()
    headers = authHeaders(await mintToken({ sub: `it-${randomUUID()}` }))
  })

  afterAll(async () => {
    if (server) {
      await stopServer(server)
    }
  })

  it('gets past the format gate and validates through the staged path', async () => {
    // Judged against gpkg-template.schema.json this file collects a
    // missing-layer error plus one unexpected-layer error per table, so a 200
    // with valid=true is the whole of the wiring working.
    const initiated = await server.inject({
      method: 'POST',
      url: '/upload/initiate',
      headers,
      payload: { redirect: '/done', s3Bucket: BUCKET, s3Path: 'baseline/' }
    })
    expect(initiated.statusCode).toBe(HTTP_OK)
    const { uploadId, uploadUrl } = initiated.result
    await uploadViaCdpUploader({ uploadUrl, filePath: FIXTURE })
    await waitForUploadStatus(server, uploadId, {
      target: 'ready',
      timeoutMs: 20_000,
      headers
    })

    const res = await server.inject({
      method: 'POST',
      url: `/baseline/validate/${uploadId}`,
      headers
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.errors).toEqual([])
    expect(res.result.valid).toBe(true)
  })
})
