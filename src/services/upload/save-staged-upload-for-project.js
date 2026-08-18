// Persist a validated STAGED GeoPackage — baseline and post-intervention as
// separate feature tables in ONE file — against a project.
//
// Both subtrees are built exactly the way the two legacy uploads would have
// built them (PostGIS sizing → extract → unit enrichment → Joi), from the same
// transformed layers, and are then written in a single transaction: one
// failure means neither subtree is persisted.
//
// Differences from running the two legacy saves back-to-back:
//
//   * featureId carry-forward runs on the STAGED shape via
//     assignStagedFeatureIds — keyed on the hidden `feature_uuid` (baseline)
//     and `PI Ref` (post-intervention) — instead of the legacy ref-only
//     assign-feature-ids step, which the transformer therefore bypasses.
//   * The post-intervention enrichment reads the baseline document built from
//     THIS file (lengths and unit totals), not whatever baseline happened to
//     be stored — both stages describe the same survey. Enhanced hedgerow /
//     watercourse children keep their own `PI Ref`; their baseline-length
//     lookup is resolved by extending the length map with each child's
//     stamped parent's length (see extendBaselineLengthsForEnhancedChildren).
//   * The per-parent removal report from staged reconciliation is persisted on
//     the post-intervention subtree as `removedHabitats` (removal-by-absence:
//     grubbed-out hedges and felled trees have no post-intervention row, so
//     nothing else records the loss).
//   * Vertical area habitats flow through both stages, sized by their
//     hand-entered face Area column.

import { enrichBaselineDocumentWithUnits } from '../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import {
  normaliseRetentionCategory,
  RETENTION_ENHANCED
} from '../../utilities/enrichment/post-intervention/retention-category.js'
import { extractHabitatData } from '../../validation/geopackage/baseline/extract-habitat-data.js'
import {
  extractPostIntervention,
  filterLostPostInterventionLayers
} from '../../validation/geopackage/post-intervention/extract-post-intervention.js'
import {
  assignStagedFeatureIds,
  buildStagedFeatureIdByRef
} from '../../validation/geopackage/lineage/staged-feature-ids.js'
import { stagedToLegacyLayers } from '../../validation/geopackage/lineage/staged-to-legacy.js'
import { HABITAT_TYPES } from '../../validation/geopackage/lineage/staged-layer-names.js'
import {
  habitatDataSchema,
  postInterventionDataSchema
} from '../../validation/project.js'
import {
  fetchStoredProject,
  enrichOptionsForPostIntervention,
  schemaErrorResponse,
  sizeUploadedHabitats
} from './save-upload-for-project.js'
import { persistStagedUpload } from './persist-upload.js'

/** Persisted document layer per staged habitat type. */
const DOCUMENT_LAYER_BY_TYPE = Object.freeze({
  [HABITAT_TYPES.AREAS]: 'habitats',
  [HABITAT_TYPES.VERTICAL_AREAS]: 'verticalAreas',
  [HABITAT_TYPES.HEDGEROWS]: 'hedgerows',
  [HABITAT_TYPES.WATERCOURSES]: 'watercourses',
  [HABITAT_TYPES.TREES]: 'trees'
})

/** Types whose Enhanced children resolve a baseline length by ref. */
const ENHANCED_LINEAR_TYPES = Object.freeze([
  HABITAT_TYPES.HEDGEROWS,
  HABITAT_TYPES.WATERCOURSES
])

/**
 * Rebuild the staged `stored` shape buildStagedFeatureIdByRef reads from the
 * persisted project document, so a re-upload carries featureIds forward. The
 * hidden baseline `feature_uuid` lives in each stored feature's verbatim
 * `properties`; the stored `ref` IS the feature's own reference (`PI Ref` on
 * the post-intervention side — the transformer never rewrites it).
 *
 * @param {object | null | undefined} project the stored project JSONB
 * @returns {object | null} a shape buildStagedFeatureIdByRef accepts
 */
export function stagedStoredShapeFromProject(project) {
  if (!project) {
    return null
  }
  const shape = { redline: [], baseline: {}, postIntervention: {} }
  for (const [type, layer] of Object.entries(DOCUMENT_LAYER_BY_TYPE)) {
    const baselineDocs = project.baseline?.[layer]
    if (Array.isArray(baselineDocs)) {
      shape.baseline[type] = baselineDocs.map((doc) => ({
        featureId: doc.featureId,
        ref: doc.ref ?? null,
        featureUuid: doc.properties?.feature_uuid ?? null
      }))
    }
    const piDocs = project.postIntervention?.[layer]
    if (Array.isArray(piDocs)) {
      shape.postIntervention[type] = piDocs.map((doc) => ({
        featureId: doc.featureId,
        piRef: doc.ref ?? null
      }))
    }
  }
  const redLineFeatureId =
    project.baseline?.redLine?.featureId ??
    project.postIntervention?.redLine?.featureId
  if (redLineFeatureId) {
    shape.redline.push({ featureId: redLineFeatureId })
  }
  return shape
}

/**
 * Resolve baseline lengths for Enhanced hedgerow / watercourse children whose
 * own ref names nothing in the baseline (a split or renamed child): map the
 * child's ref to its STAMPED parent's baseline length. Extending the map —
 * rather than rewriting the child's ref to the parent's — keeps featureId
 * stability and keeps two children of one parent distinguishable.
 *
 * KNOWN LIMITATION, deliberate: each child resolves the FULL parent baseline
 * length, because the legacy Enhanced calculation has no way to express
 * partial-parent enhancement. Returned so the caller can log every such case
 * rather than let it happen silently.
 *
 * @param {Map<string, number>} baselineLengthByRef mutated in place
 * @param {Record<string, object[]>} postInterventionByType staged PI features
 * @returns {Array<{ type: string, childRef: string, parentRef: string }>} the added mappings
 */
export function extendBaselineLengthsForEnhancedChildren(
  baselineLengthByRef,
  postInterventionByType
) {
  const added = []
  for (const type of ENHANCED_LINEAR_TYPES) {
    for (const feature of postInterventionByType?.[type] ?? []) {
      const childRef = feature?.piRef ?? feature?.ref
      const parentRef = feature?.parentRef
      if (
        normaliseRetentionCategory(feature?.retentionCategory) !==
          RETENTION_ENHANCED ||
        !childRef ||
        !parentRef ||
        baselineLengthByRef.has(childRef)
      ) {
        continue
      }
      const parentLength = baselineLengthByRef.get(parentRef)
      if (parentLength != null) {
        baselineLengthByRef.set(childRef, parentLength)
        added.push({ type, childRef, parentRef })
      }
    }
  }
  return added
}

/**
 * Map reconcileParents' removal report (snake_case, straight from the staged
 * validation) onto the persisted `removedHabitats` shape:
 *
 *   [{ type, parentRef, measure, baselineSize, removedSize }]
 *
 * with type ∈ areas|verticalAreas|hedgerows|watercourses|trees and
 * measure ∈ area|length|count. The report is REUSED from validation — never
 * recomputed here — so the persisted rows always agree with the
 * STAGED_FEATURES_REMOVED warning the user was shown.
 *
 * @param {Array<{ type: string, parent_ref: string, measure: string, baseline_size: number, removed_size: number }>} removed
 * @returns {Array<{ type: string, parentRef: string, measure: string, baselineSize: number, removedSize: number }>}
 */
export function removedHabitatsFromReport(removed = []) {
  return removed.map((entry) => ({
    type: entry.type,
    parentRef: entry.parent_ref,
    measure: entry.measure,
    baselineSize: entry.baseline_size,
    removedSize: entry.removed_size
  }))
}

/**
 * Size, extract, enrich and schema-check one stage. Returns either
 * `{ extracted }` or `{ response }` (a recoverable-error Hapi response).
 */
async function buildStage({
  pgPool,
  layersWithIds,
  layersForSizing,
  extract,
  enrich,
  documentSchema,
  meta,
  reporting
}) {
  const sizing = await sizeUploadedHabitats(pgPool, layersForSizing, reporting)
  if (sizing.response) {
    return { response: sizing.response }
  }
  const extracted = extract(layersWithIds, {
    ...meta,
    habitatSizes: sizing.habitatSizes
  })
  enrich(extracted.document)
  const { error } = documentSchema.validate(extracted.document, {
    allowUnknown: true
  })
  if (error) {
    return { response: schemaErrorResponse(error, reporting) }
  }
  return { extracted }
}

/**
 * Persist both subtrees of a valid staged upload. Returns a Hapi response on
 * any recoverable error, or `null` on success — mirroring
 * saveUploadForProject so the route treats both paths identically.
 *
 * @param {{ drizzle: import('drizzle-orm/node-postgres').NodePgDatabase, pgPool: import('pg').Pool, logger: { info: Function, error: Function, warn: Function } }} deps
 * @param {string} projectId
 * @param {{ staged: object, removed: object[] }} stagedResult from validateStagedGeoPackage
 * @param {{ uploadId: string, credentials: { sub: string }, filename?: string | null, fileSize?: number | null }} context
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{ routeName: string }} config
 */
export async function saveStagedUploadForProject(
  deps,
  projectId,
  stagedResult,
  context,
  h,
  config
) {
  const { drizzle, pgPool, logger } = deps
  const { uploadId, credentials, filename, fileSize } = context
  const reporting = { logger, routeName: config.routeName, uploadId, h }
  const meta = { uploadId, filename, fileSize }

  // Same staleness trade-off as the legacy path: this read sits outside the
  // FOR UPDATE lock taken in persistStagedUpload, and concurrent uploads for
  // the same project already 409 on the lock timeout.
  const storedProject = await fetchStoredProject(drizzle, projectId)
  const stagedWithIds = assignStagedFeatureIds(
    stagedResult.staged,
    buildStagedFeatureIdByRef(stagedStoredShapeFromProject(storedProject))
  )
  const { baseline, postIntervention } = stagedToLegacyLayers(stagedWithIds)

  const baselineStage = await buildStage({
    pgPool,
    layersWithIds: baseline,
    layersForSizing: baseline,
    extract: extractHabitatData,
    enrich: (document) => enrichBaselineDocumentWithUnits(document, logger),
    documentSchema: habitatDataSchema,
    meta: { ...meta, variant: 'baseline' },
    reporting
  })
  if (baselineStage.response) {
    return baselineStage.response
  }
  const baselineDocument = baselineStage.extracted.document

  // The freshly built baseline, not the stored one: both stages come from the
  // same file, so Enhanced linear lookups and net-change figures must
  // reconcile against it.
  const enrichOptions = enrichOptionsForPostIntervention(baselineDocument)
  const extendedLengths = extendBaselineLengthsForEnhancedChildren(
    enrichOptions.baselineLengthByRef,
    stagedWithIds.postIntervention
  )
  for (const { type, childRef, parentRef } of extendedLengths) {
    logger.warn(
      `${config.routeName} - uploadId ${uploadId}: Enhanced ${type} "${childRef}" resolves the FULL baseline length of its parent "${parentRef}" — the legacy shape cannot express partial-parent enhancement`
    )
  }

  const piStage = await buildStage({
    pgPool,
    layersWithIds: postIntervention,
    layersForSizing: filterLostPostInterventionLayers(postIntervention),
    extract: extractPostIntervention,
    enrich: (document) =>
      enrichPostInterventionDocumentWithUnits(document, logger, enrichOptions),
    documentSchema: postInterventionDataSchema,
    meta,
    reporting
  })
  if (piStage.response) {
    return piStage.response
  }
  piStage.extracted.document.removedHabitats = removedHabitatsFromReport(
    stagedResult.removed
  )
  // removedHabitats was attached after the buildStage schema check, so it gets
  // its own: a shape drift here must fail loudly, not persist silently.
  const { error } = postInterventionDataSchema.validate(
    piStage.extracted.document,
    { allowUnknown: true }
  )
  if (error) {
    return schemaErrorResponse(error, reporting)
  }

  await persistStagedUpload(
    drizzle,
    projectId,
    {
      baseline: baselineStage.extracted,
      postIntervention: piStage.extracted
    },
    { uploadId, logger, credentials }
  )
  return null
}
