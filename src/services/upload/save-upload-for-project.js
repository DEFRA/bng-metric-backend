import { eq } from 'drizzle-orm'

import { assignFeatureIds } from '../../validation/geopackage/assign-feature-ids.js'
import { buildFeatureIdByRef } from '../../validation/geopackage/carry-forward-feature-ids.js'
import { enrichBaselineDocumentWithUnits } from '../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { postInterventionEnrichOptions } from '../../utilities/enrichment/post-intervention/post-intervention-enrich-options.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import { extractHabitatData } from '../../validation/geopackage/baseline/extract-habitat-data.js'
import {
  extractPostIntervention,
  filterLostPostInterventionLayers
} from '../../validation/geopackage/post-intervention/extract-post-intervention.js'
import { rejectInvalidEnhancements } from '../../validation/geopackage/post-intervention/reject-invalid-enhancements.js'
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
import {
  attachGeometrySizes,
  calculateHabitatSizes
} from './calculate-habitat-sizes.js'
import { normaliseImportedDocument } from '../../validation/geopackage/normalise-imported-attributes.js'
import { enforceRequiredAttributeCompleteness } from '../../utilities/enrichment/shared/required-attribute-completeness.js'
import {
  countRowsWithoutBaselineType,
  filterBaselineLayers
} from './baseline-rows.js'
import { persistCombinedUpload, persistUpload } from './persist-upload.js'
import { metricsMillis } from '../../common/helpers/metrics.js'
import { PERFORMANCE_METRIC } from '../../common/helpers/metric-names.js'
import {
  logPerf,
  perfNow,
  msSince
} from '../../common/helpers/perf-evidence.js'

const POST_INTERVENTION_DOCUMENT_KEY = 'postIntervention'

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
    // Import only: an edit or a baseline re-derive never re-checks them.
    checkDocument: rejectInvalidEnhancements,
    enrichDocument: enrichPostInterventionDocumentWithUnits,
    documentSchema: postInterventionDataSchema
  })
})

/**
 * Read the project's currently stored JSONB document, for the featureId
 * carry-forward. A post-intervention upload replaces both subtrees, so it
 * carries ids forward from each. One read covers both.
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

// saveHandlersForConfig, layersForUpload and extractAndValidateDocument are
// exported for the metric comparison in bng-metric-harness
// (scripts/metric-comparison), which runs this pipeline in process, without a
// database, to compare the service's figures with the metric's (BMD-1036).

/**
 * @param {object} config
 */
export function saveHandlersForConfig(config) {
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
 * @param {object} layers
 * @param {object|undefined} storedProject
 * @param {string} projectDocumentKey
 * @param {object} [geometrySizes] per-feature measurements from the geometry
 *   engine, keyed by position within the layer
 */
export function layersForUpload(
  layers,
  storedProject,
  projectDocumentKey,
  geometrySizes
) {
  const featureIdByRef = buildFeatureIdByRef(
    storedProject?.[projectDocumentKey]
  )
  if (projectDocumentKey === POST_INTERVENTION_DOCUMENT_KEY) {
    // Sizes are stamped on BEFORE the post-intervention Lost filter, because they
    // are keyed by a feature's position and that filter renumbers what is left.
    // Ids stay on the unfiltered layers: a Lost row and the Created row that
    // replaces it share a ref, and both belong in this document.
    const layersWithSizes = attachGeometrySizes(
      assignFeatureIds(layers, featureIdByRef),
      geometrySizes
    )
    return {
      layersWithIds: layersWithSizes,
      layersForSizing: filterLostPostInterventionLayers(layersWithSizes)
    }
  }
  // A combined file uploaded as a baseline ignores Created rows: they are
  // post-intervention data. A placeholder type such as "N/A" is kept, so a
  // pure baseline file still shows that parcel for the user to complete.
  // Ids are assigned after the filter, so uniqueness is counted on the
  // rows that remain.
  const baselineLayers = assignFeatureIds(
    filterBaselineLayers(attachGeometrySizes(layers, geometrySizes)),
    featureIdByRef
  )
  return { layersWithIds: baselineLayers, layersForSizing: baselineLayers }
}

/**
 * The baseline a post-intervention file describes, read from its Baseline*
 * columns before the post-intervention Lost filter: a Lost feature is exactly
 * what the baseline must still hold. Created rows are ignored, and so is a
 * Lost row whose Baseline type is blank or a placeholder. A Retained or
 * Enhanced row with no Baseline type is rejected before extraction.
 *
 * Feature ids are carried forward from the stored baseline, not the stored
 * post-intervention document: the two are separate feature sets. They are
 * assigned after Created rows are removed. A Lost row and the Created row
 * that replaces it often share a ref; counted together, that ref is not
 * unique and the Lost row would receive a new id on every upload.
 *
 * @param {object} layers the raw layers of a post-intervention upload
 * @param {object|undefined} storedProject
 * @param {object} [geometrySizes] per-feature measurements, keyed by position
 * @returns {object} layers ready for sizing and baseline extraction
 */
export function derivedBaselineLayers(layers, storedProject, geometrySizes) {
  const featureIdByRef = buildFeatureIdByRef(storedProject?.baseline)
  const baselineLayers = filterBaselineLayers(
    attachGeometrySizes(layers, geometrySizes),
    { strict: true }
  )
  return assignFeatureIds(baselineLayers, featureIdByRef)
}

async function sizeUploadedHabitats(
  { layersForSizing, baselineLayers },
  { logger, routeName, uploadId, h }
) {
  try {
    return {
      habitatSizes: calculateHabitatSizes(layersForSizing),
      baselineHabitatSizes: baselineLayers
        ? calculateHabitatSizes(baselineLayers)
        : undefined
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

/**
 * @param {object} args
 * @param {object} [args.baselineDocument] the baseline a post-intervention
 *   document is enriched against; defaults to the stored baseline
 */
export function extractAndValidateDocument({
  handlers,
  layersWithIds,
  storedProject,
  context,
  logger,
  config,
  habitatSizes,
  baselineDocument = storedProject?.baseline
}) {
  const { uploadId, filename, fileSize } = context
  const meta = {
    uploadId,
    filename,
    fileSize,
    habitatSizes
  }
  const { document, geometries } = handlers.extractDocument(layersWithIds, meta)
  normaliseImportedDocument(
    document,
    config.projectDocumentKey === POST_INTERVENTION_DOCUMENT_KEY
  )
  handlers.checkDocument?.(document, logger)
  const enrichOptions =
    config.projectDocumentKey === POST_INTERVENTION_DOCUMENT_KEY
      ? postInterventionEnrichOptions(baselineDocument)
      : {}
  handlers.enrichDocument(document, logger, enrichOptions)
  enforceRequiredAttributeCompleteness(
    document,
    config.projectDocumentKey === POST_INTERVENTION_DOCUMENT_KEY
  )
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

const BASELINE_DOCUMENT_CONFIG = Object.freeze({
  projectDocumentKey: 'baseline'
})

const NO_DERIVED_BASELINE_HABITATS_MESSAGE =
  'This post-intervention file has no baseline area habitats, so it cannot replace the project baseline'

function missingBaselineTypeError(layers) {
  const count = countRowsWithoutBaselineType(layers)
  if (count === 0) {
    return null
  }
  return makeError(
    ERROR_CODES.BASELINE_TYPE_MISSING,
    `${count} retained or enhanced rows have no baseline habitat type, so the baseline cannot be derived from this file`
  )
}

function derivedBaselineHasAreaHabitats(document) {
  return Array.isArray(document?.habitats) && document.habitats.length > 0
}

/**
 * Extract, enrich and schema-check the upload. A post-intervention upload
 * yields two documents: the baseline derived from the file, then the
 * post-intervention document enriched against that baseline — not the stored
 * one, which the same transaction is about to replace.
 *
 * @returns {{ schemaError?: object, validationError?: object, document?: object, geometries?: object, baseline?: object, postIntervention?: object }}
 */
function extractUploadDocuments(sized, context, logger, config) {
  const { layersWithIds, baselineLayers, storedProject } = sized
  const shared = { storedProject, context, logger }
  if (!baselineLayers) {
    return extractAndValidateDocument({
      ...shared,
      handlers: saveHandlersForConfig(config),
      layersWithIds,
      config,
      habitatSizes: sized.habitatSizes
    })
  }
  const missingBaselineType = missingBaselineTypeError(layersWithIds)
  if (missingBaselineType) {
    return { validationError: missingBaselineType }
  }
  const baseline = extractAndValidateDocument({
    ...shared,
    handlers: SAVE_HANDLERS_BY_DOCUMENT_KEY.baseline,
    layersWithIds: baselineLayers,
    config: BASELINE_DOCUMENT_CONFIG,
    habitatSizes: sized.baselineHabitatSizes
  })
  if (baseline.schemaError) {
    return { schemaError: baseline.schemaError }
  }
  // A file made only of Created rows, or Lost rows whose Baseline type is
  // blank or a placeholder, derives no area habitats. Writing that document
  // would delete the stored baseline and every feature edit on it.
  if (!derivedBaselineHasAreaHabitats(baseline.document)) {
    return {
      validationError: makeError(
        ERROR_CODES.NO_DERIVED_BASELINE_HABITATS,
        NO_DERIVED_BASELINE_HABITATS_MESSAGE
      )
    }
  }
  const postIntervention = extractAndValidateDocument({
    ...shared,
    handlers: saveHandlersForConfig(config),
    layersWithIds,
    config,
    habitatSizes: sized.habitatSizes,
    baselineDocument: baseline.document
  })
  return {
    schemaError: postIntervention.schemaError,
    baseline,
    postIntervention
  }
}

async function persistExtractedUpload(
  drizzle,
  projectId,
  extracted,
  { uploadId, credentials, logger, config }
) {
  if (extracted.baseline) {
    await persistCombinedUpload(
      drizzle,
      projectId,
      {
        baseline: extracted.baseline,
        postIntervention: extracted.postIntervention
      },
      { uploadId, logger, credentials, uploadLabel: config.uploadLabel }
    )
    return
  }
  await persistUpload(
    drizzle,
    projectId,
    extracted.document,
    extracted.geometries,
    {
      uploadId,
      logger,
      credentials,
      projectDocumentKey: config.projectDocumentKey,
      uploadLabel: config.uploadLabel
    }
  )
}

/**
 * Time the sizing pass.
 *
 * Kept as a timed stage even though it no longer does any real work — the
 * measurements now arrive with the validation verdict, so this is a map over
 * features rather than the second PostGIS round trip it used to be. The metric
 * stays so the drop is visible on the dashboard rather than silently vanishing.
 *
 * @param {{ layersForSizing: object, baselineLayers?: object }} layers
 * @param {{ logger: object, uploadId: string, documentKey: string }} stageContext
 * @param {{ config: object, h: import('@hapi/hapi').ResponseToolkit }} deps
 * @returns {Promise<{ habitatSizes?: object, baselineHabitatSizes?: object, response?: object }>}
 */
function runSizingStage(layers, stageContext, { config, h }) {
  const { logger, uploadId } = stageContext
  return timeSaveStage(
    {
      ...stageContext,
      metricName: PERFORMANCE_METRIC.sizingMs,
      stage: 'sizing'
    },
    () =>
      sizeUploadedHabitats(layers, {
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
 * @param {{ stageContext: object, layersWithIds: object, baselineLayers?: object, storedProject: object | undefined, habitatSizes: object, baselineHabitatSizes?: object }} sized
 * @param {{ uploadId: string, credentials: { sub: string } }} context
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {object} config
 */
async function saveSizedUpload(drizzle, projectId, sized, context, h, config) {
  const { stageContext } = sized
  const { logger, uploadId } = stageContext

  // Evidence (Item 8 — extract and engine enrichment loop every feature inline):
  // fully synchronous, so this blocks the event loop for its whole duration.
  const extracted = await timeSaveStage(
    {
      ...stageContext,
      metricName: PERFORMANCE_METRIC.enrichMs,
      stage: 'enrich'
    },
    () => extractUploadDocuments(sized, context, logger, config)
  )
  if (extracted.schemaError) {
    return schemaErrorResponse(extracted.schemaError, {
      logger,
      routeName: config.routeName,
      uploadId,
      h
    })
  }
  if (extracted.validationError) {
    logger.info(
      `${config.routeName} - derived baseline rejected uploadId ${uploadId}: ${extracted.validationError.message}`
    )
    return h.response({
      valid: false,
      errors: [extracted.validationError]
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
      persistExtractedUpload(drizzle, projectId, extracted, {
        uploadId,
        credentials: context.credentials,
        logger,
        config
      })
  )
  return null
}

/**
 * Sizes, extracts, validates against the Joi schema, and persists the upload
 * document for a known-valid set of layers. Returns a Hapi response on any
 * recoverable error, or `null` on success.
 *
 * @param {{ drizzle: import('drizzle-orm/node-postgres').NodePgDatabase, logger: { info: Function, error: Function, warn: Function } }} deps
 * @param {string} projectId
 * @param {object} layers
 * @param {{ uploadId: string, credentials: { sub: string }, filename?: string | null, fileSize?: number | null, geometrySizes?: object }} context
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
  const { drizzle, logger } = deps
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
    projectDocumentKey,
    context.geometrySizes
  )
  const baselineLayers =
    projectDocumentKey === POST_INTERVENTION_DOCUMENT_KEY
      ? derivedBaselineLayers(layers, storedProject, context.geometrySizes)
      : undefined

  const sizing = await runSizingStage(
    { layersForSizing, baselineLayers },
    stageContext,
    { config, h }
  )
  if (sizing.response) {
    return sizing.response
  }

  return saveSizedUpload(
    drizzle,
    projectId,
    {
      stageContext,
      layersWithIds,
      baselineLayers,
      storedProject,
      habitatSizes: sizing.habitatSizes,
      baselineHabitatSizes: sizing.baselineHabitatSizes
    },
    context,
    h,
    config
  )
}
