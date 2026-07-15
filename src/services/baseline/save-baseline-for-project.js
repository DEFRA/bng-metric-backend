import { eq } from 'drizzle-orm'

import { assignFeatureIds } from '../../validation/baseline/assign-feature-ids.js'
import { enrichBaselineDocumentWithUnits } from '../../utilities/baseline/enrich-baseline-units.js'
import { buildBaselineLinearLengthByRef } from '../../utilities/baseline/baseline-linear-length-by-ref.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/baseline/enrich-post-intervention-units.js'
import { reEnrichStoredPostInterventionIfPresent } from '../../utilities/baseline/re-enrich-stored-post-intervention.js'
import { extractHabitatData } from '../../validation/baseline/extract-habitat-data.js'
import {
  extractPostIntervention,
  filterLostLinearPostInterventionLayers
} from '../../validation/baseline/extract-post-intervention.js'
import { ERROR_CODES, makeError } from '../../validation/baseline/errors.js'
import {
  habitatDataSchema,
  postInterventionDataSchema
} from '../../validation/project.js'
import { HTTP_STATUS } from '../../common/helpers/http/status-codes.js'
import { projects } from '../../db/schema/index.js'
import { calculateHabitatSizes } from './calculate-habitat-sizes.js'
import { persistBaseline } from './persist-baseline.js'

function extractBaselineDocument(layers, meta) {
  return extractHabitatData(layers, { ...meta, variant: 'baseline' })
}

const SAVE_HANDLERS_BY_DOCUMENT_KEY = Object.freeze({
  baseline: Object.freeze({
    extractDocument: extractBaselineDocument,
    enrichDocument: enrichBaselineDocumentWithUnits,
    documentSchema: habitatDataSchema
  }),
  postIntervention: Object.freeze({
    extractDocument: extractPostIntervention,
    enrichDocument: enrichPostInterventionDocumentWithUnits,
    documentSchema: postInterventionDataSchema
  })
})

/**
 * Build a Map<parcelRef, lengthKm> from the project's stored baseline linear
 * features. Returns an empty Map when the project has no baseline or no
 * hedgerows/watercourses.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @returns {Promise<Map<string, number>>}
 */
async function fetchBaselineLinearLengthByRef(drizzle, projectId) {
  const [row] = await drizzle
    .select({ project: projects.project })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  const baseline = row?.project?.baseline
  return buildBaselineLinearLengthByRef(
    baseline?.hedgerows ?? [],
    baseline?.watercourses ?? []
  )
}

/**
 * @param {object} config
 */
function saveHandlersForConfig(config) {
  const handlers = SAVE_HANDLERS_BY_DOCUMENT_KEY[config.projectDocumentKey]
  if (handlers) {
    return handlers
  } else {
    throw new Error(
      `Unsupported projectDocumentKey: ${config.projectDocumentKey}`
    )
  }
}

/**
 * Sizes, extracts, validates against the Joi schema, and persists the baseline
 * document for a known-valid set of layers. Returns a Hapi response on any
 * recoverable error, or `null` on success.
 *
 * @param {{ drizzle: import('drizzle-orm/node-postgres').NodePgDatabase, pgPool: import('pg').Pool, logger: { info: Function, error: Function, warn: Function } }} deps
 * @param {string} projectId
 * @param {object} layers
 * @param {{ uploadId: string, sub?: string, filename?: string | null, fileSize?: number | null }} context
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {object} config
 */
export async function saveBaselineForProject(
  deps,
  projectId,
  layers,
  context,
  h,
  config
) {
  const { drizzle, pgPool, logger } = deps
  const { uploadId, sub, filename, fileSize } = context
  const layersWithIds = assignFeatureIds(layers)
  const layersForSizing =
    config.projectDocumentKey === 'postIntervention'
      ? filterLostLinearPostInterventionLayers(layersWithIds)
      : layersWithIds

  let habitatSizes
  try {
    habitatSizes = await calculateHabitatSizes(pgPool, layersForSizing)
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

  const handlers = saveHandlersForConfig(config)
  const meta = { uploadId, filename, fileSize, habitatSizes }
  const { document, geometries } = handlers.extractDocument(layersWithIds, meta)

  let enrichOptions = {}
  if (config.projectDocumentKey === 'postIntervention') {
    const baselineLengthByRef = await fetchBaselineLinearLengthByRef(
      drizzle,
      projectId
    )
    enrichOptions = { baselineLengthByRef }
  }
  handlers.enrichDocument(document, logger, enrichOptions)

  const { error: schemaError } = handlers.documentSchema.validate(document, {
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
  } else {
    await persistBaseline(drizzle, projectId, document, geometries, {
      uploadId,
      logger,
      sub,
      projectDocumentKey: config.projectDocumentKey,
      uploadLabel: config.uploadLabel
    })
    if (config.projectDocumentKey === 'baseline') {
      await reEnrichStoredPostInterventionIfPresent(drizzle, projectId, logger)
    }
    return null
  }
}
