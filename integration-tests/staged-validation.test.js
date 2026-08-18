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
const HEDGE_TOTAL_M = 200
const TREE_REMOVED_COUNT = 1

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

function warningFor(result, code) {
  return (result.warnings ?? []).find((warning) => warning.code === code)
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

  it('reports the clean export\u2019s removals as warnings, not errors', async () => {
    // The fixture deliberately carries two removals: the grubbed-out half of
    // hedgerow HR-1 and felled tree T-2, both recorded by absence. Neither
    // may fail the file, but the surveyor must be told what the calculation
    // will assume.
    const result = await validateStagedGeoPackage(FIXTURE, pool)

    expect(result.valid).toBe(true)
    const warning = warningFor(result, ERROR_CODES.STAGED_FEATURES_REMOVED)
    expect(warning.details.sample).toEqual([
      {
        type: 'hedgerows',
        parent_ref: 'HR-1',
        measure: 'length',
        baseline_size: expect.closeTo(HEDGE_TOTAL_M, 1),
        pi_size: expect.closeTo(HEDGE_HALF_M, 1),
        removed_size: expect.closeTo(HEDGE_HALF_M, 1)
      },
      {
        type: 'trees',
        parent_ref: 'T-2',
        measure: 'count',
        baseline_size: TREE_REMOVED_COUNT,
        pi_size: 0,
        removed_size: TREE_REMOVED_COUNT
      }
    ])
  })

  it('survives a mangled Parent Ref when the uuid stamp is intact', async () => {
    // The whole point of the hidden uuid: renames and typos on the visible
    // ref can no longer break lineage.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `UPDATE "Habitats Post-Intervention" SET "Parent Ref" = 'GONE' WHERE "PI Ref" = 'PR-1'`
      ).run()
    })

    expect(
      errorFor(result, ERROR_CODES.STAGED_UNKNOWN_PARENT_REF)
    ).toBeUndefined()
    expect(
      errorFor(result, ERROR_CODES.STAGED_PI_OUTSIDE_PARENT)
    ).toBeUndefined()
    expect(result.valid).toBe(true)
  })

  it('warns when a stamped checksum no longer matches the baseline geometry', async () => {
    // Simulates the baseline being edited after the copy: the stamp was made
    // from a shape that no longer exists. Watercourses are containment-exempt,
    // so the drift warning is the only signal — exactly the point of it.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `UPDATE "Watercourses Post-Intervention" SET parent_checksum = '0123456789abcdef'`
      ).run()
    })

    expect(result.valid).toBe(true)
    const warning = warningFor(result, ERROR_CODES.STAGED_BASELINE_DRIFTED)
    expect(warning.details.sample).toEqual([
      { type: 'watercourses', parent_ref: 'WC-1', pi_count: 1 }
    ])
  })

  it('flags a continuing row with no stamp at all as inferred lineage', async () => {
    // A file made outside the template's copy action: the parent is guessed
    // from geometric overlap and the surveyor is asked to confirm.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `UPDATE "Hedgerows Post-Intervention" SET "Parent Ref" = NULL, parent_uuid = NULL WHERE "PI Ref" = 'HR-1a'`
      ).run()
    })

    expect(result.valid).toBe(true)
    const warning = warningFor(result, ERROR_CODES.STAGED_PARENT_INFERRED)
    expect(warning.details.sample).toEqual([
      { type: 'hedgerows', pi_ref: 'HR-1a', parent_ref: 'HR-1' }
    ])
  })

  it('emits no drift or inferred warnings for a clean template export', async () => {
    const result = await validateStagedGeoPackage(FIXTURE, pool)

    expect(
      warningFor(result, ERROR_CODES.STAGED_BASELINE_DRIFTED)
    ).toBeUndefined()
    expect(
      warningFor(result, ERROR_CODES.STAGED_PARENT_INFERRED)
    ).toBeUndefined()
  })

  it('rejects a stamped parent that names nothing in the baseline', async () => {
    // Left unreported this degrades quietly: deriveLineage falls through to the
    // geometry rule and the parcel picks up a plausible parent it never had.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `UPDATE "Habitats Post-Intervention" SET "Parent Ref" = 'GONE', parent_uuid = NULL WHERE "PI Ref" = 'PR-1'`
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

  it('treats a deleted hedgerow row as removal — a warning, not an error', async () => {
    // The inverse of the old "totals must balance" rule: grubbing out the
    // whole hedge is recorded by deleting its copied row, exactly as the
    // Statutory Metric derives lost length as the residual on the baseline.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `DELETE FROM "Hedgerows Post-Intervention" WHERE "PI Ref" = 'HR-1a'`
      ).run()
    })

    expect(result.valid).toBe(true)
    expect(errorFor(result, ERROR_CODES.STAGED_SIZE_MISMATCH)).toBeUndefined()

    const warning = warningFor(result, ERROR_CODES.STAGED_FEATURES_REMOVED)
    const hedge = warning.details.sample.find((s) => s.type === 'hedgerows')
    expect(hedge).toMatchObject({ parent_ref: 'HR-1', measure: 'length' })
    expect(hedge.removed_size).toBeCloseTo(HEDGE_TOTAL_M, 1)
  })

  it('still rejects area totals that no longer balance', async () => {
    // Area habitats keep the exact rule: ground inside the red line cannot
    // vanish, and an absent parcel is indistinguishable from a mapping gap.
    const result = await validateMutatedFixture((db) => {
      db.prepare(
        `DELETE FROM "Habitats Post-Intervention" WHERE "PI Ref" = 'PI-POND'`
      ).run()
    })

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_SIZE_MISMATCH)
    expect(error.details.sample[0]).toMatchObject({
      type: 'areas',
      measure: 'area'
    })
    expect(error.details.sample[0].delta).toBeGreaterThan(0)
  })

  it('rejects children that outgrow their stamped parent', async () => {
    // Two pasted duplicates of the retained half: children total 300 m
    // against a 200 m parent. A shortfall is a removal; an excess is always
    // a duplicated or mis-stamped row.
    const result = await validateMutatedFixture((db) => {
      for (const piRef of ['HR-1a-copy1', 'HR-1a-copy2']) {
        db.prepare(
          `INSERT INTO "Hedgerows Post-Intervention"
             (geom, "PI Ref", "Parent Ref", "Retention Category")
           SELECT geom, ?, "Parent Ref", "Retention Category"
           FROM "Hedgerows Post-Intervention" WHERE "PI Ref" = 'HR-1a'`
        ).run(piRef)
      }
    })

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_PARENT_OVERSUBSCRIBED)
    expect(error.details.sample[0]).toMatchObject({
      type: 'hedgerows',
      parent_ref: 'HR-1',
      measure: 'length'
    })
    expect(error.details.sample[0].excess).toBeCloseTo(HEDGE_HALF_M, 1)
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
    // The removal warning must survive the route boundary — the frontend is
    // what actually shows it to the surveyor.
    expect(res.result.warnings.map((warning) => warning.code)).toContain(
      ERROR_CODES.STAGED_FEATURES_REMOVED
    )
  })
})
