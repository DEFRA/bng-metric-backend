import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Boom from '@hapi/boom'
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
import { enrichBaselineDocumentWithUnits } from '../utilities/baseline/enrich-baseline-units.js'
import { extractBaseline } from '../validation/baseline/extract-baseline.js'
import { assignFeatureIds } from '../validation/baseline/assign-feature-ids.js'
import { validateBaselineLayers } from '../validation/baseline/index.js'
import { calculateHabitatSizes } from '../services/baseline/calculate-habitat-sizes.js'
import { persistBaseline } from '../services/baseline/persist-baseline.js'
import { ERROR_CODES, makeError } from '../validation/baseline/errors.js'
import { baselineSchema } from '../validation/project.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { metricsCounter, metricsByteSize } from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_CATEGORY
} from '../common/helpers/metric-names.js'

const logger = createLogger()

// CDP Uploader reports a virus rejection via the file's errorMessage (e.g.
// "The selected file contains a virus"); match it to categorise the metric.
const VIRUS_REJECTION_PATTERN = /virus/i

/** Prefix for ephemeral GeoPackage staging directories under os.tmpdir(). */
const BASELINE_UPLOAD_TEMP_PREFIX = 'baseline-'

/** Fixed filename inside the staging directory (not derived from user input). */
const BASELINE_UPLOAD_TEMP_FILENAME = 'baseline.gpkg'

const BASELINE_VALIDATION_CONFIG = Object.freeze({
  routeName: 'validateBaseline',
  path: '/baseline/validate/{uploadId}',
  projectDocumentKey: 'baseline',
  uploadLabel: 'baseline',
  validationFailedMessage: 'Unable to validate baseline file'
})

const POST_INTERVENTION_VALIDATION_CONFIG = Object.freeze({
  routeName: 'validatePostIntervention',
  path: '/post-intervention/validate/{uploadId}',
  projectDocumentKey: 'postIntervention',
  uploadLabel: 'post-intervention',
  validationFailedMessage: 'Unable to validate post-intervention file'
})

async function resolveUploadLocation(
  uploadId,
  config = BASELINE_VALIDATION_CONFIG
) {
  try {
    return await waitForUploadReady(uploadId)
  } catch (err) {
    if (err instanceof UploadTimeoutError) {
      logger.error(
        `${config.routeName}: upload did not become ready for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Upload did not complete in time')
    }
    if (err instanceof UploadFailedError) {
      logger.error(
        `${config.routeName}: upload was rejected for uploadId ${uploadId}: ${err.message}`
      )
      if (VIRUS_REJECTION_PATTERN.test(err.errorMessage ?? '')) {
        await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
          category: VALIDATION_CATEGORY.virus
        })
      }
      throw Boom.badData('Upload was rejected')
    }
    logger.error(
      `${config.routeName}: upload failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Unable to verify upload status')
  }
}

async function fetchBaselineBuffer(
  bucket,
  key,
  uploadId,
  config = BASELINE_VALIDATION_CONFIG
) {
  try {
    return await downloadFile(bucket, key)
  } catch (err) {
    if (err instanceof S3FileTooLargeError) {
      logger.error(
        `${config.routeName}: S3 object too large for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.entityTooLarge('File exceeds the maximum allowed size')
    }
    if (err instanceof S3TimeoutError) {
      logger.error(
        `${config.routeName}: S3 download timed out for uploadId ${uploadId}: ${err.message}`
      )
      throw Boom.gatewayTimeout('Timed out downloading file from storage')
    }
    logger.error(
      `${config.routeName}: S3 download failed for uploadId ${uploadId}: ${err.message}`
    )
    throw Boom.badGateway('Unable to download file from storage')
  }
}

function validateUploadMetadata(
  uploadId,
  filename,
  fileSize,
  h,
  config = BASELINE_VALIDATION_CONFIG
) {
  const { error: metaError } = baselineSchema.validate(
    { uploadId, filename, fileSize },
    { allowUnknown: true }
  )
  if (!metaError) {
    return null
  }

  logger.info(
    `${config.routeName} - metadata schema rejected uploadId ${uploadId}: ${metaError.message}`
  )
  return h.response({
    valid: false,
    errors: [makeError(ERROR_CODES.INVALID_FILE_METADATA, metaError.message)]
  })
}

/**
 * Sizes, extracts, validates against the Joi schema, and persists the baseline
 * document for a known-valid set of layers. Returns a Hapi response on any
 * recoverable error, or `null` on success.
 */
async function saveBaselineForProject(
  drizzle,
  pgPool,
  projectId,
  layers,
  context,
  h,
  config = BASELINE_VALIDATION_CONFIG
) {
  const { uploadId, filename, fileSize } = context
  const layersWithIds = assignFeatureIds(layers)

  let habitatSizes
  try {
    habitatSizes = await calculateHabitatSizes(pgPool, layersWithIds)
  } catch (err) {
    logger.error(
      `${config.routeName} - sizing failed for uploadId ${uploadId}: ${err.message}`
    )
    return h
      .response({
        valid: false,
        errors: [
          makeError(
            ERROR_CODES.SIZING_FAILED,
            'Unable to calculate habitat sizes'
          )
        ]
      })
      .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }

  const { document, geometries } = extractBaseline(layersWithIds, {
    uploadId,
    filename,
    fileSize,
    habitatSizes
  })

  enrichBaselineDocumentWithUnits(document, logger)
  const { error: schemaError } = baselineSchema.validate(document, {
    allowUnknown: true
  })
  if (schemaError) {
    logger.info(
      `${config.routeName} - document schema rejected uploadId ${uploadId}: ${schemaError.message}`
    )
    return h.response({
      valid: false,
      errors: [
        makeError(ERROR_CODES.INVALID_FILE_METADATA, schemaError.message)
      ]
    })
  }

  await persistBaseline(drizzle, projectId, document, geometries, {
    uploadId,
    logger,
    projectDocumentKey: config.projectDocumentKey,
    uploadLabel: config.uploadLabel
  })
  return null
}

async function runFullValidation(
  buffer,
  drizzle,
  pgPool,
  context,
  h,
  config = BASELINE_VALIDATION_CONFIG
) {
  const { uploadId, projectId, filename, fileSize } = context
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), BASELINE_UPLOAD_TEMP_PREFIX)
  )
  const localPath = path.join(tmpDir, BASELINE_UPLOAD_TEMP_FILENAME)

  try {
    await fs.writeFile(localPath, buffer)
    const layers = readBaselineGeoPackage(localPath)
    const result = await validateBaselineLayers(layers, pgPool)
    if (!result.valid) {
      logger.info(
        `${config.routeName} - rejected uploadId ${uploadId}: ${result.errors
          .map((e) => `${e.code}: ${e.message}`)
          .join(' | ')}`
      )
      await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
        category: VALIDATION_CATEGORY.geometric
      })
      return h.response(result)
    }
    logger.info(`${config.routeName} - accepted uploadId ${uploadId}`)
    await metricsCounter(GEOPACKAGE_METRIC.validationSucceeded)
    if (projectId) {
      const errorResponse = await saveBaselineForProject(
        drizzle,
        pgPool,
        projectId,
        layers,
        { uploadId, filename, fileSize },
        h,
        config
      )
      if (errorResponse) {
        return errorResponse
      } else {
        return h.response(result)
      }
    } else {
      return h.response(result)
    }
  } catch (error) {
    if (error?.isBoom) {
      throw error
    } else {
      logger.error(
        `${config.routeName} - error validating uploadId ${uploadId}: ${error.message}`
      )
      return h
        .response({
          valid: false,
          errors: [
            makeError(
              ERROR_CODES.VALIDATION_FAILED,
              config.validationFailedMessage
            )
          ]
        })
        .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
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
/**
 * @openapi
 * /post-intervention/validate/{uploadId}:
 *   post:
 *     tags:
 *       - Post Intervention
 *     summary: Validate a post-intervention GeoPackage upload
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId:
 *                 type: string
 *                 format: uuid
 *                 description: Saves the unpacked post-intervention data against the project's JSONB document.
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
 *       400:
 *         description: uploadId or projectId is missing or not a valid UUID
 *       404:
 *         description: projectId does not match an existing project
 *       409:
 *         description: Another post-intervention upload for the same project is currently being persisted - retry shortly
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
function createValidateGeoPackageRoute(config) {
  return {
    method: 'POST',
    path: config.path,
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

      const { bucket, key, filename, fileSize } = await resolveUploadLocation(
        uploadId,
        config
      )
      if (fileSize != null) {
        await metricsByteSize(GEOPACKAGE_METRIC.uploadSizeBytes, fileSize)
      }
      if (projectId) {
        const metadataErrorResponse = validateUploadMetadata(
          uploadId,
          filename,
          fileSize,
          h,
          config
        )
        if (metadataErrorResponse) {
          return metadataErrorResponse
        }
      }

      const buffer = await fetchBaselineBuffer(bucket, key, uploadId, config)

      const gateResult = validateGpkg(buffer)
      if (!gateResult.valid) {
        logger.info(
          `${config.routeName} - rejected at gpkg gate uploadId ${uploadId}`
        )
        await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
          category: VALIDATION_CATEGORY.internalData
        })
        return h.response(gateResult)
      }

      return runFullValidation(
        buffer,
        request.drizzle,
        request.pg,
        { uploadId, projectId, filename, fileSize },
        h,
        config
      )
    }
  }
}

const validateBaseline = createValidateGeoPackageRoute(
  BASELINE_VALIDATION_CONFIG
)
const validatePostIntervention = createValidateGeoPackageRoute(
  POST_INTERVENTION_VALIDATION_CONFIG
)

export { validateBaseline, validatePostIntervention }
