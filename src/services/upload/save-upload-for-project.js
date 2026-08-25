import { eq } from 'drizzle-orm'

import { assignFeatureIds } from '../../validation/geopackage/assign-feature-ids.js'
import { buildFeatureIdByRef } from '../../validation/geopackage/carry-forward-feature-ids.js'
import { enrichBaselineDocumentWithUnits } from '../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { buildBaselineLinearLengthByRef } from '../../utilities/enrichment/post-intervention/linear-baseline-length-by-ref.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import { extractHabitatData } from '../../validation/geopackage/baseline/extract-habitat-data.js'
import {
  extractPostIntervention,
  filterLostPostInterventionLayers
} from '../../validation/geopackage/post-intervention/extract-post-intervention.js'
import {
  ERROR_CODES,
  makeError,
  makeMetadataError
} from '../../validation/geopackage/errors.js'
import {
  habitatDataSchema,
  postInterventionDataSchema
} from '../../validation/project.js'
import { HTTP_STATUS } from '../../common/helpers/http/status-codes.js'
import { projects } from '../../db/schema/index.js'
import { calculateHabitatSizes } from './calculate-habitat-sizes.js'
import { persistUpload } from './persist-upload.js'
import { metricsMillis } from '../../common/helpers/metrics.js'
import { PERFORMANCE_METRIC } from '../../common/helpers/metric-names.js'
import {
  logPerf,
  perfNow,
  msSince
} from '../../common/helpers/perf-evidence.js'

/**
 * Record one save-stage duration as both a `pipeline-inline` evidence line (for
 * log search, keyed by uploadId) and an EMF duration metric (for the Grafana
 * dashboard, dimensioned only by documentKey). See recordStage in
 * src/routes/validate-geopackage-route.js for why both exist.
 *
 * @param {{ info?: Function }} logger
 * @param {string} metricName one of PERFORMANCE_METRIC
 * @param {number} durationMs
 * @param {object} fields evidence-line fields (must include `stage`)
 * @param {string} documentKey
 */
async function recordSaveStage(
  logger,
  metricName,
  durationMs,
  fields,
  documentKey
) {
  logPerf(logger, 'pipeline-inline', { ...fields, elapsedMs: durationMs })
  await metricsMillis(metricName, durationMs, { documentKey })
}

/**
 * Run one save stage, timing it and recording the duration via
 * {@link recordSaveStage}. The stage is always recorded, including when it
 * produces a failure the caller turns into an error response — a slow stage is
 * evidence whether or not it succeeded.
 *
 * @param {{ logger: { info?: Function }, metricName: string, stage: string, uploadId: string, documentKey: string }} stage
 * @param {() => T | Promise<T>} run the stage's work
 * @returns {Promise<T>} whatever `run` returned
 * @template T
 */
async function timeSaveStage(
  { logger, metricName, stage, uploadId, documentKey },
  run
) {
  const start = perfNow()
  const result = await run()
  await recordSaveStage(
    logger,
    metricName,
    msSince(start),
    { uploadId, stage },
    documentKey
  )
  return result
}

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

function layersForUpload(layers, storedProject, projectDocumentKey) {
  const featureIdByRef = buildFeatureIdByRef(
    storedProject?.[projectDocumentKey]
  )
  const layersWithIds = assignFeatureIds(layers, featureIdByRef)
  const layersForSizing =
    projectDocumentKey === 'postIntervention'
      ? filterLostPostInterventionLayers(layersWithIds)
      : layersWithIds
  return { layersWithIds, layersForSizing }
}

async function sizeUploadedHabitats(
  pgPool,
  layersForSizing,
  { logger, routeName, uploadId, h }
) {
  try {
    return {
      habitatSizes: await calculateHabitatSizes(pgPool, layersForSizing)
    }
  } catch (err) {
    logger.error(
      `${routeName} - sizing failed for uploadId ${uploadId}: ${err.message}`
    )
    const response = h
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
    return { response }
  }
}

function extractAndValidateDocument({
  handlers,
  layersWithIds,
  storedProject,
  context,
  logger,
  config,
  habitatSizes
}) {
  const { uploadId, filename, fileSize } = context
  const meta = { uploadId, filename, fileSize, habitatSizes }
  const { document, geometries } = handlers.extractDocument(layersWithIds, meta)
  const enrichOptions =
    config.projectDocumentKey === 'postIntervention'
      ? enrichOptionsForPostIntervention(storedProject?.baseline)
      : {}
  handlers.enrichDocument(document, logger, enrichOptions)
  const { error } = handlers.documentSchema.validate(document, {
    allowUnknown: true
  })
  return { document, geometries, schemaError: error }
}

function schemaErrorResponse(schemaError, { logger, routeName, uploadId, h }) {
  logger.info(
    `${routeName} - document schema rejected uploadId ${uploadId}: ${schemaError.message}`
  )
  return h.response({
    valid: false,
    errors: [makeMetadataError(schemaError)]
  })
}

async function persistUploadAndMaybeReEnrich(
  drizzle,
  projectId,
  document,
  geometries,
  { uploadId, credentials, logger, config }
) {
  await persistUpload(drizzle, projectId, document, geometries, {
    uploadId,
    logger,
    credentials,
    projectDocumentKey: config.projectDocumentKey,
    uploadLabel: config.uploadLabel
  })
}

/**
 * Time the PostGIS sizing pass.
 *
 * Evidence (Item 6 — the sizing pass is a second PostGIS round trip): a
 * separate awaited query that recomputes ST_MakeValid per feature, on top of
 * the geometry-repair work the validation statement already did.
 *
 * @param {import('pg').Pool} pgPool
 * @param {object} layersForSizing
 * @param {{ logger: object, uploadId: string, documentKey: string }} stageContext
 * @param {{ config: object, h: import('@hapi/hapi').ResponseToolkit }} deps
 * @returns {Promise<{ habitatSizes?: object, response?: object }>}
 */
function runSizingStage(pgPool, layersForSizing, stageContext, { config, h }) {
  const { logger, uploadId } = stageContext
  return timeSaveStage(
    {
      ...stageContext,
      metricName: PERFORMANCE_METRIC.sizingMs,
      stage: 'sizing'
    },
    () =>
      sizeUploadedHabitats(pgPool, layersForSizing, {
        logger,
        routeName: config.routeName,
        uploadId,
        h
      })
  )
}

/**
 * Extract, enrich, validate and persist the upload document once the habitat
 * sizes are known. Returns a Hapi response if the document fails its schema,
 * or `null` on success.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @param {{ stageContext: object, layersWithIds: object, storedProject: object | undefined, habitatSizes: object }} sized
 * @param {{ uploadId: string, credentials: { sub: string } }} context
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {object} config
 */
async function saveSizedUpload(drizzle, projectId, sized, context, h, config) {
  const { stageContext, layersWithIds, storedProject, habitatSizes } = sized
  const { logger, uploadId } = stageContext

  // Evidence (Item 8 — extract and engine enrichment loop every feature inline):
  // fully synchronous, so this blocks the event loop for its whole duration.
  const extracted = await timeSaveStage(
    {
      ...stageContext,
      metricName: PERFORMANCE_METRIC.enrichMs,
      stage: 'enrich'
    },
    () =>
      extractAndValidateDocument({
        handlers: saveHandlersForConfig(config),
        layersWithIds,
        storedProject,
        context,
        logger,
        config,
        habitatSizes
      })
  )
  if (extracted.schemaError) {
    return schemaErrorResponse(extracted.schemaError, {
      logger,
      routeName: config.routeName,
      uploadId,
      h
    })
  }

  // Evidence (Item 1): the persist transaction — batched geometry inserts plus
  // the JSONB document update — still on the same request handler.
  await timeSaveStage(
    {
      ...stageContext,
      metricName: PERFORMANCE_METRIC.persistMs,
      stage: 'persist'
    },
    () =>
      persistUploadAndMaybeReEnrich(
        drizzle,
        projectId,
        extracted.document,
        extracted.geometries,
        { uploadId, credentials: context.credentials, logger, config }
      )
  )
  return null
}

/**
 * Sizes, extracts, validates against the Joi schema, and persists the upload
 * document for a known-valid set of layers. Returns a Hapi response on any
 * recoverable error, or `null` on success.
 *
 * @param {{ drizzle: import('drizzle-orm/node-postgres').NodePgDatabase, pgPool: import('pg').Pool, logger: { info: Function, error: Function, warn: Function } }} deps
 * @param {string} projectId
 * @param {object} layers
 * @param {{ uploadId: string, credentials: { sub: string }, filename?: string | null, fileSize?: number | null }} context
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {object} config
 */
export async function saveUploadForProject(
  deps,
  projectId,
  layers,
  context,
  h,
  config
) {
  const { drizzle, pgPool, logger } = deps
  const { projectDocumentKey } = config
  const stageContext = {
    logger,
    uploadId: context.uploadId,
    documentKey: projectDocumentKey
  }
  // Reuse the featureIds already stored for this document wherever the incoming
  // `ref` matches, so a re-upload updates the downstream relational rows rather
  // than replacing them wholesale. This read sits outside the FOR UPDATE lock
  // taken later in persistUpload: a concurrent upload could make it stale,
  // but the worst outcome is a fresh UUID where one could have been reused, and
  // concurrent uploads for the same project already 409 on the lock timeout.
  const storedProject = await fetchStoredProject(drizzle, projectId)
  const { layersWithIds, layersForSizing } = layersForUpload(
    layers,
    storedProject,
    projectDocumentKey
  )

  const sizing = await runSizingStage(pgPool, layersForSizing, stageContext, {
    config,
    h
  })
  if (sizing.response) {
    return sizing.response
  }

  return saveSizedUpload(
    drizzle,
    projectId,
    {
      stageContext,
      layersWithIds,
      storedProject,
      habitatSizes: sizing.habitatSizes
    },
    context,
    h,
    config
  )
}
