import { eq } from 'drizzle-orm'

import { assignFeatureIds } from '../../validation/baseline/assign-feature-ids.js'
import { buildFeatureIdByRef } from '../../validation/baseline/carry-forward-feature-ids.js'
import { enrichBaselineDocumentWithUnits } from '../../utilities/baseline/enrich-baseline-units.js'
import { buildBaselineLinearLengthByRef } from '../../utilities/baseline/baseline-linear-length-by-ref.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/baseline/enrich-post-intervention-units.js'
import { extractHabitatData } from '../../validation/baseline/extract-habitat-data.js'
import {
  extractPostIntervention,
  filterLostPostInterventionLayers
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
 * Read the project's currently stored JSONB document. Serves two consumers:
 * the featureId carry-forward (which needs the subtree being replaced) and the
 * post-intervention enrichment (which needs the stored baseline). One read
 * covers both.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @returns {Promise<object | undefined>}
 */
async function fetchStoredProject(drizzle, projectId) {
  const [row] = await drizzle
    .select({ project: projects.project })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return row?.project
}

function enrichOptionsForPostIntervention(baseline) {
  return {
    baselineLengthByRef: buildBaselineLinearLengthByRef(
      baseline?.hedgerows ?? [],
      baseline?.watercourses ?? []
    ),
    baselineUnits: baseline?.units
  }
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
  // Reuse the featureIds already stored for this document wherever the incoming
  // `ref` matches, so a re-upload updates the downstream relational rows rather
  // than replacing them wholesale. This read sits outside the FOR UPDATE lock
  // taken later in persistBaseline: a concurrent upload could make it stale,
  // but the worst outcome is a fresh UUID where one could have been reused, and
  // concurrent uploads for the same project already 409 on the lock timeout.
  const storedProject = await fetchStoredProject(drizzle, projectId)
  const featureIdByRef = buildFeatureIdByRef(
    storedProject?.[config.projectDocumentKey]
  )
  const layersWithIds = assignFeatureIds(layers, featureIdByRef)
  const layersForSizing =
    config.projectDocumentKey === 'postIntervention'
      ? filterLostPostInterventionLayers(layersWithIds)
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
    enrichOptions = enrichOptionsForPostIntervention(storedProject?.baseline)
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
    return null
  }
}
