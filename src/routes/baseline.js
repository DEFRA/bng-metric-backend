import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'

import {
  waitForUploadReady,
  UploadFailedError,
  UploadTimeoutError
} from '../services/cdp-uploader/cdp-uploader.js'
import {
  downloadFile,
  S3FileTooLargeError,
  S3TimeoutError
} from '../services/s3/download-file.js'
import {
  validateGpkg,
  readBaselineGeoPackage
} from '../validation/baseline/geopackage.js'
import { extractBaseline } from '../validation/baseline/extract-baseline.js'
import { validateBaselineLayers } from '../validation/baseline/index.js'
import { calculateHabitatSizes } from '../services/baseline/calculate-habitat-sizes.js'
import { ERROR_CODES, makeError } from '../validation/baseline/errors.js'
import {
  projects,
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses
} from '../db/schema/index.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

const logger = createLogger()

async function resolveUploadLocation(uploadId) {
  try {
    return await waitForUploadReady(uploadId)
  } catch (err) {
    if (err instanceof UploadTimeoutError) {
      logger.error(
        `validateBaseline: upload did not become ready for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Upload did not complete in time')
    }
    if (err instanceof UploadFailedError) {
      logger.error(
        `validateBaseline: upload was rejected for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.badData('Upload was rejected')
    }
    logger.error(
      `validateBaseline: upload failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Unable to verify upload status')
  }
}

async function fetchBaselineBuffer(bucket, key, uploadId) {
  try {
    return await downloadFile(bucket, key)
  } catch (err) {
    if (err instanceof S3FileTooLargeError) {
      logger.error(
        `validateBaseline: S3 object too large for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.entityTooLarge('File exceeds the maximum allowed size')
    }
    if (err instanceof S3TimeoutError) {
      logger.error(
        `validateBaseline: S3 download timed out for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Timed out downloading file from storage')
    }
    logger.error(
      `validateBaseline: S3 download failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Unable to download file from storage')
  }
}

// PostGIS has no built-in upsert for geometry; ST_Multi promotes Polygon →
// MultiPolygon (and LineString → MultiLineString), and ST_Transform standardises
// every geometry to EPSG:27700 regardless of the source SRID, matching what the
// validation pipeline already enforces.

// Cap rows per INSERT to keep statement size bounded — PostgreSQL allows up to
// 65535 bind parameters per query, and a large site with thousands of features
// is rare but possible. 500 leaves ample headroom and matches typical batch
// tuning advice for PostGIS bulk loads.
const INSERT_BATCH_SIZE = 500

function geometryRowValues(projectId, row) {
  const geomJson = JSON.stringify(row.geometry)
  return sql`(
    ${row.featureId}::uuid,
    ${projectId}::uuid,
    ${row.ref ?? null},
    ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), ${row.srid}), 27700))
  )`
}

async function insertGeometryRowsBatched(tx, table, projectId, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const values = batch.map((row) => geometryRowValues(projectId, row))
    await tx.execute(sql`
      INSERT INTO ${table} (id, project_id, ref, geom)
      VALUES ${sql.join(values, sql`, `)}
    `)
  }
}

async function insertRedLineRow(tx, projectId, row) {
  const geomJson = JSON.stringify(row.geometry)
  await tx.execute(sql`
    INSERT INTO ${baselineRedLine} (id, project_id, geom)
    VALUES (
      ${row.featureId}::uuid,
      ${projectId}::uuid,
      ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), ${row.srid}), 27700))
    )
  `)
}

async function persistBaseline(
  drizzle,
  projectId,
  document,
  geometries,
  uploadId
) {
  try {
    await runPersistTransaction(drizzle, projectId, document, geometries)
  } catch (err) {
    if (err?.isBoom) {
      throw err
    }
    // PostgreSQL 55P03 (lock_not_available) means SELECT ... FOR UPDATE waited
    // past the 5s lock_timeout for another transaction mid-persist on the same
    // project. Surface as 409 so the caller can retry; persist is normally
    // sub-second so a 5s wait is well past "another one in progress."
    if (err?.code === '55P03') {
      throw Boom.conflict(
        'Another baseline upload for this project is in progress'
      )
    }
    throw err
  }

  logger.info(
    `validateBaseline: persisted baseline for projectId ${projectId} from uploadId ${uploadId}`
  )
}

async function runPersistTransaction(drizzle, projectId, document, geometries) {
  await drizzle.transaction(async (tx) => {
    // Cap the wait on the project row lock so a stuck or pathologically slow
    // concurrent persist can't hang this request indefinitely. 5s is generous
    // — the lock holder's own work (delete + batched inserts + JSONB update)
    // should finish in well under a second for realistic dataset sizes.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)

    // SELECT ... FOR UPDATE serialises concurrent re-uploads for the same
    // project. Without this, two interleaved POSTs could each DELETE the
    // prior baseline rows and INSERT new ones — UNIQUE(project_id) on
    // baseline_red_line would trip one of them, but the other three tables
    // would briefly double up before rollback.
    const projectRows = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')
      .limit(1)
    if (projectRows.length === 0) {
      throw Boom.notFound(`Project ${projectId} not found`)
    }

    // Re-upload safety: drop any prior baseline rows before inserting new
    // ones. ON DELETE CASCADE on the project FK does not help here — the
    // project is not being deleted.
    await tx
      .delete(baselineRedLine)
      .where(eq(baselineRedLine.projectId, projectId))
    await tx
      .delete(baselineHabitats)
      .where(eq(baselineHabitats.projectId, projectId))
    await tx
      .delete(baselineHedgerows)
      .where(eq(baselineHedgerows.projectId, projectId))
    await tx
      .delete(baselineWatercourses)
      .where(eq(baselineWatercourses.projectId, projectId))

    if (geometries.redLine) {
      await insertRedLineRow(tx, projectId, geometries.redLine)
    }
    await insertGeometryRowsBatched(
      tx,
      baselineHabitats,
      projectId,
      geometries.habitats
    )
    await insertGeometryRowsBatched(
      tx,
      baselineHedgerows,
      projectId,
      geometries.hedgerows
    )
    await insertGeometryRowsBatched(
      tx,
      baselineWatercourses,
      projectId,
      geometries.watercourses
    )

    const docJson = JSON.stringify(document)
    await tx
      .update(projects)
      .set({
        project: sql`jsonb_set(${projects.project}, '{baseline}', ${docJson}::jsonb, true)`
      })
      .where(eq(projects.id, projectId))
  })
}

async function runFullValidation(buffer, drizzle, pgPool, context, h) {
  const { uploadId, projectId } = context
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-'))
  const localPath = path.join(tmpDir, 'baseline.gpkg')

  try {
    await fs.writeFile(localPath, buffer)
    const layers = readBaselineGeoPackage(localPath)
    const result = await validateBaselineLayers(layers, pgPool)
    if (result.valid) {
      logger.info(`validateBaseline - accepted uploadId ${uploadId}`)
      if (projectId) {
        const habitatSizes = await calculateHabitatSizes(pgPool, layers)
        const { document, geometries } = extractBaseline(layers, { uploadId, habitatSizes })
        await persistBaseline(drizzle, projectId, document, geometries, uploadId)
      }
      return h.response(result)
    } else {
      logger.info(
        `validateBaseline - rejected uploadId ${uploadId}: ${result.errors
          .map((e) => `${e.code}: ${e.message}`)
          .join(' | ')}`
      )
    }
    return h.response(result)
  } catch (error) {
    if (error?.isBoom) {
      throw error
    }
    logger.error(
      `validateBaseline - error validating uploadId ${uploadId}: ${error.message}`
    )
    return h
      .response({
        valid: false,
        errors: [
          makeError(
            ERROR_CODES.VALIDATION_FAILED,
            'Unable to validate baseline file'
          )
        ]
      })
      .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * @openapi
 * /baseline/validate/{uploadId}:
 *   post:
 *     tags:
 *       - Baseline
 *     summary: Validate a baseline GeoPackage upload
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId:
 *                 type: string
 *                 format: uuid
 *                 description: When provided, the unpacked baseline data is saved against the project's JSONB document.
 *     responses:
 *       200:
 *         description: Returns validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code: { type: string }
 *                       message: { type: string }
 *                       details:
 *                         type: object
 *                         description: |
 *                           Structured payload, present on list-bearing error
 *                           codes (e.g. AREA_PARCELS_OUTSIDE_REDLINE,
 *                           PARCEL_OVERLAPS, SLIVERS_INSIDE_REDLINE).
 *                           Always carries `count` (the truthful total of
 *                           offending features) and `sample` (a capped array
 *                           of per-feature objects with `idx`, `fid`, and
 *                           `feature_ref` — overlaps and slivers carry
 *                           variant shapes).
 *                         properties:
 *                           count: { type: integer }
 *                           sample:
 *                             type: array
 *                             items: { type: object }
 *       400:
 *         description: uploadId is missing or not a valid UUID
 *       404:
 *         description: projectId was provided but does not match an existing project
 *       409:
 *         description: Another baseline upload for the same project is currently being persisted — retry shortly
 *       413:
 *         description: File exceeds the maximum allowed size (100 MB)
 *       422:
 *         description: Upload was rejected by CDP Uploader
 *       500:
 *         description: Validation pipeline raised an unexpected error
 *       502:
 *         description: Upload status could not be verified, or S3 connection error
 *       504:
 *         description: Upload did not reach ready state in time, or S3 download timed out
 */
const validateBaseline = {
  method: 'POST',
  path: '/baseline/validate/{uploadId}',
  options: {
    validate: {
      params: Joi.object({
        uploadId: Joi.string().uuid().required()
      }),
      payload: Joi.object({
        projectId: Joi.string().uuid()
      })
        .allow(null)
        .optional()
    }
  },
  handler: async (request, h) => {
    const { uploadId } = request.params
    const projectId = request.payload?.projectId ?? null

    const { bucket, key } = await resolveUploadLocation(uploadId)
    const buffer = await fetchBaselineBuffer(bucket, key, uploadId)

    const gateResult = validateGpkg(buffer)
    if (!gateResult.valid) {
      logger.info(
        `validateBaseline - rejected at gpkg gate uploadId ${uploadId}`
      )
      return h.response(gateResult)
    }

    return runFullValidation(
      buffer,
      request.drizzle,
      request.pg,
      { uploadId, projectId },
      h
    )
  }
}

export { validateBaseline }
