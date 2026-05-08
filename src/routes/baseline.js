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
import { validateGpkg } from '../services/gpkg/validate-gpkg.js'
import { extractBaseline } from '../services/gpkg/extract-baseline.js'
import { readBaselineGeoPackage } from '../validation/baseline/geopackage.js'
import { validateBaselineLayers } from '../validation/baseline/index.js'
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

async function insertPolygonRow(tx, table, projectId, row) {
  const geomJson = JSON.stringify(row.geometry)
  const includeRef = table !== baselineRedLine
  if (includeRef) {
    await tx.execute(sql`
      INSERT INTO ${table} (id, project_id, ref, geom)
      VALUES (
        ${row.featureId}::uuid,
        ${projectId}::uuid,
        ${row.ref ?? null},
        ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), ${row.srid}), 27700))
      )
    `)
  } else {
    await tx.execute(sql`
      INSERT INTO ${table} (id, project_id, geom)
      VALUES (
        ${row.featureId}::uuid,
        ${projectId}::uuid,
        ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), ${row.srid}), 27700))
      )
    `)
  }
}

async function insertLineRow(tx, table, projectId, row) {
  const geomJson = JSON.stringify(row.geometry)
  await tx.execute(sql`
    INSERT INTO ${table} (id, project_id, ref, geom)
    VALUES (
      ${row.featureId}::uuid,
      ${projectId}::uuid,
      ${row.ref ?? null},
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
  await drizzle.transaction(async (tx) => {
    const projectRows = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
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
      await insertPolygonRow(tx, baselineRedLine, projectId, geometries.redLine)
    }
    for (const row of geometries.habitats) {
      await insertPolygonRow(tx, baselineHabitats, projectId, row)
    }
    for (const row of geometries.hedgerows) {
      await insertLineRow(tx, baselineHedgerows, projectId, row)
    }
    for (const row of geometries.watercourses) {
      await insertLineRow(tx, baselineWatercourses, projectId, row)
    }

    const docJson = JSON.stringify(document)
    await tx
      .update(projects)
      .set({
        project: sql`jsonb_set(${projects.project}, '{baseline}', ${docJson}::jsonb, true)`,
        updatedAt: sql`now()`
      })
      .where(eq(projects.id, projectId))
  })

  logger.info(
    `validateBaseline: persisted baseline for projectId ${projectId} from uploadId ${uploadId}`
  )
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
        const { document, geometries } = extractBaseline(layers, { uploadId })
        await persistBaseline(
          drizzle,
          projectId,
          document,
          geometries,
          uploadId
        )
      }
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
          {
            code: 'VALIDATION_FAILED',
            message: 'Unable to validate baseline file'
          }
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
