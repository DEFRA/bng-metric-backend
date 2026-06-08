import { beforeEach, describe, expect, it, vi } from 'vitest'
import Boom from '@hapi/boom'

import { PG_LOCK_NOT_AVAILABLE } from '../../db/postgres-error-codes.js'
import { EPSG_BNG } from '../../validation/baseline/geopackage-constants.js'
import {
  PROJECT_ID,
  FEATURE_ID_HAB,
  STUB_EXTRACTED,
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
      { uploadId: UPLOAD_ID, logger }
    )

    expect(log.transactionCalls).toBe(1)
    expect(log.selectCalls).toBe(1)
    expect(log.deletes).toHaveLength(4)
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
      STUB_EXTRACTED.document,
      STUB_EXTRACTED.geometries,
      {
        uploadId: UPLOAD_ID,
        logger,
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
      { uploadId: UPLOAD_ID, logger }
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
      { uploadId: UPLOAD_ID, logger }
    )

    // lock_timeout + red line + 2 habitat batches + hedgerow + watercourse
    expect(log.executes).toHaveLength(6)
  })

  it('throws 404 when the project does not exist', async () => {
    const { drizzle } = makeDrizzle({ projectExists: false })

    await expect(
      persistBaseline(
        drizzle,
        PROJECT_ID,
        STUB_EXTRACTED.document,
        STUB_EXTRACTED.geometries,
        { uploadId: UPLOAD_ID, logger }
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
        { uploadId: UPLOAD_ID, logger }
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
        { uploadId: UPLOAD_ID, logger }
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
        { uploadId: UPLOAD_ID, logger }
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
      { uploadId: UPLOAD_ID, logger }
    )

    expect(log.executes.length).toBeGreaterThan(0)
  })
})
