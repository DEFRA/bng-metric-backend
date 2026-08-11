import { beforeEach, describe, expect, it, vi } from 'vitest'
import Boom from '@hapi/boom'
import { PgDialect } from 'drizzle-orm/pg-core'

import { PG_LOCK_NOT_AVAILABLE } from '../../db/postgres-error-codes.js'
import { EPSG_BNG } from '../../validation/baseline/geopackage-constants.js'
import {
  PROJECT_ID,
  SUB,
  RELATIONSHIP_ID,
  CREDENTIALS,
  FEATURE_ID_HAB,
  STUB_EXTRACTED,
  STUB_POST_INTERVENTION_EXTRACTED,
  SAMPLE_GEOM,
  makeDrizzle
} from '../../routes/baseline.test-fixtures.js'
import { persistBaseline } from './persist-baseline.js'

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
/** Mirrors INSERT_BATCH_SIZE in persist-baseline.js */
const PERSIST_INSERT_BATCH_SIZE = 500

function makeGeometries(overrides = {}) {
  return { ...STUB_EXTRACTED.geometries, ...overrides }
}

function makeManyHabitatRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    featureId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    ref: `P${index}`,
    geometry: SAMPLE_GEOM,
    srid: EPSG_BNG
  }))
}

describe('persistBaseline', () => {
  let logger

  beforeEach(() => {
    logger = { info: vi.fn() }
  })

  it('persists document and geometry rows in a transaction', async () => {
    const { drizzle, log } = makeDrizzle()

    await persistBaseline(
      drizzle,
      PROJECT_ID,
      STUB_EXTRACTED.document,
      STUB_EXTRACTED.geometries,
      { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
    )

    expect(log.transactionCalls).toBe(1)
    expect(log.selectCalls).toBe(1)
    expect(log.deletes).toHaveLength(5)
    expect(log.executes).toHaveLength(5)
    expect(log.updates).toHaveLength(1)
    expect(logger.info).toHaveBeenCalledWith(
      `baseline: persisted baseline for projectId ${PROJECT_ID} from uploadId ${UPLOAD_ID}`
    )
  })

  it('uses the upload label in the persistence success log', async () => {
    const { drizzle } = makeDrizzle()

    await persistBaseline(
      drizzle,
      PROJECT_ID,
      STUB_POST_INTERVENTION_EXTRACTED.document,
      STUB_POST_INTERVENTION_EXTRACTED.geometries,
      {
        uploadId: UPLOAD_ID,
        logger,
        credentials: CREDENTIALS,
        projectDocumentKey: 'postIntervention',
        uploadLabel: 'post-intervention'
      }
    )

    expect(logger.info).toHaveBeenCalledWith(
      `post-intervention: persisted post-intervention for projectId ${PROJECT_ID} from uploadId ${UPLOAD_ID}`
    )
  })

  it('skips red line insert when geometries.redLine is absent', async () => {
    const { drizzle, log } = makeDrizzle()

    await persistBaseline(
      drizzle,
      PROJECT_ID,
      STUB_EXTRACTED.document,
      makeGeometries({ redLine: null }),
      { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
    )

    expect(log.executes).toHaveLength(4)
  })

  it('inserts habitat geometry rows in batches when count exceeds the batch size', async () => {
    const { drizzle, log } = makeDrizzle()
    const batchCount = PERSIST_INSERT_BATCH_SIZE + 1
    const geometries = makeGeometries({
      habitats: makeManyHabitatRows(batchCount)
    })

    await persistBaseline(
      drizzle,
      PROJECT_ID,
      STUB_EXTRACTED.document,
      geometries,
      { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
    )

    // lock_timeout + red line + 2 habitat batches + hedgerow + watercourse
    expect(log.executes).toHaveLength(6)
  })

  it('scopes the project lock to a project visible to the requesting user', async () => {
    const { drizzle, log } = makeDrizzle()

    await persistBaseline(
      drizzle,
      PROJECT_ID,
      STUB_EXTRACTED.document,
      STUB_EXTRACTED.geometries,
      { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
    )

    expect(log.projectWhere).toHaveLength(1)
    const { sql: lockSql, params } = new PgDialect().sqlToQuery(
      log.projectWhere[0]
    )
    // The FOR UPDATE lock must enforce RBAC visibility (ownership + the current
    // org context + an approved role for it), not just match the project id — so
    // a user cannot overwrite another org's baseline by supplying its UUID.
    expect(lockSql).toContain('bng.roles')
    expect(lockSql).toContain('status')
    expect(lockSql).toContain('is not distinct from')
    expect(params).toContain(SUB)
    expect(params).toContain(RELATIONSHIP_ID)
    expect(params).toContain(PROJECT_ID)
  })

  it('throws 404 when the project is not visible to the user', async () => {
    // visibleToUser scoping means an unowned / non-approved project returns no
    // row from the locked SELECT — indistinguishable from a missing project.
    const { drizzle } = makeDrizzle({ projectExists: false })

    await expect(
      persistBaseline(
        drizzle,
        PROJECT_ID,
        STUB_EXTRACTED.document,
        STUB_EXTRACTED.geometries,
        { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
      )
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 404 }
    })
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('throws 409 when the project row lock cannot be acquired', async () => {
    const lockError = Object.assign(new Error('lock timeout'), {
      code: PG_LOCK_NOT_AVAILABLE
    })
    const { drizzle } = makeDrizzle({ lockError })

    await expect(
      persistBaseline(
        drizzle,
        PROJECT_ID,
        STUB_EXTRACTED.document,
        STUB_EXTRACTED.geometries,
        { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
      )
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 409 },
      message: 'Another baseline upload for this project is in progress'
    })
  })

  it('re-throws Boom errors unchanged', async () => {
    const boom = Boom.badRequest('bad request')
    const drizzle = {
      transaction: vi.fn(() => Promise.reject(boom))
    }

    await expect(
      persistBaseline(
        drizzle,
        PROJECT_ID,
        STUB_EXTRACTED.document,
        STUB_EXTRACTED.geometries,
        { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
      )
    ).rejects.toBe(boom)
  })

  it('re-throws unexpected errors', async () => {
    const err = new Error('database unavailable')
    const drizzle = {
      transaction: vi.fn(() => Promise.reject(err))
    }

    await expect(
      persistBaseline(
        drizzle,
        PROJECT_ID,
        STUB_EXTRACTED.document,
        STUB_EXTRACTED.geometries,
        { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
      )
    ).rejects.toBe(err)
  })

  it('persists rows with a null ref when ref is omitted', async () => {
    const { drizzle, log } = makeDrizzle()
    const geometries = makeGeometries({
      habitats: [
        {
          featureId: FEATURE_ID_HAB,
          geometry: SAMPLE_GEOM,
          srid: EPSG_BNG
        }
      ]
    })

    await persistBaseline(
      drizzle,
      PROJECT_ID,
      STUB_EXTRACTED.document,
      geometries,
      { uploadId: UPLOAD_ID, logger, credentials: CREDENTIALS }
    )

    expect(log.executes.length).toBeGreaterThan(0)
  })
})
