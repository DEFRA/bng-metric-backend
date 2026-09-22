// Re-derive the post-intervention document after the baseline it was measured
// against has been edited.
//
// The post-intervention document carries its own copy of the baseline: every
// feature's `baseline` sub-object holds that row's Baseline * GeoPackage
// columns, and nothing re-reads it once imported. Editing a baseline feature
// therefore used to leave two disagreeing copies of the same parcel, and every
// figure computed from the post-intervention side kept quoting the old one —
// per-feature units, the unit totals, the net unit changes, and the area
// trading-rules figures the Met / Not-met verdict is derived from.
//
// A baseline *re-upload* has never had this problem: setProjectBaseline drops
// the whole postIntervention subtree in the same statement. An edit is the
// path that leaves the two documents to diverge, so it is the path that
// re-derives.
//
// The join key is `ref` — the Parcel Ref / Tree Ref column — for the same
// reason carry-forward-feature-ids.js and buildBaselineLinearLengthByRef use
// it: featureIds are assigned per document, so a baseline parcel and the
// post-intervention row describing it share no id. Matching is as conservative
// as the featureId carry-forward: a blank ref, or one carried by more than one
// baseline feature, says nothing about which feature is meant, so the
// post-intervention row is left as imported.

import { normaliseRef } from '../../../validation/geopackage/carry-forward-feature-ids.js'
import { NO_OP_LOGGER } from '../shared/enrich-units-shared.js'
import {
  RETAINED_AREA_PROPOSED_FIELDS,
  RETAINED_HEDGEROW_PROPOSED_FIELDS,
  RETAINED_TREE_PROPOSED_FIELDS,
  RETAINED_WATERCOURSE_PROPOSED_FIELDS
} from './copy-retained-proposed-from-baseline.js'
import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import { postInterventionEnrichOptions } from './post-intervention-enrich-options.js'
import {
  RETENTION_CREATED,
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'

const LOG_PREFIX = 'resyncPostInterventionBaseline: '

/**
 * The fields that say *what a feature is*, as opposed to the scores enrichment
 * derives from them. This is the same set the retained-proposed copy uses, and
 * deliberately shares its lists: a column that identifies a habitat on one side
 * identifies it on the other, so a new one is added in a single place.
 *
 * Trees are included for completeness — they are not editable today
 * (`recomputeForType` in apply-feature-update.js has no tree branch), so no
 * route can currently make a tree's two copies disagree.
 */
const IDENTITY_FIELDS_BY_LAYER = Object.freeze({
  habitats: RETAINED_AREA_PROPOSED_FIELDS,
  trees: RETAINED_TREE_PROPOSED_FIELDS,
  hedgerows: RETAINED_HEDGEROW_PROPOSED_FIELDS,
  watercourses: RETAINED_WATERCOURSE_PROPOSED_FIELDS
})

/**
 * Index one baseline layer by ref, dropping blank refs and any ref carried by
 * more than one feature — mirrors addLayerEntries in
 * carry-forward-feature-ids.js, and for the same reason: uniqueness is only
 * *enforced* on the habitats layer.
 *
 * @param {object[] | undefined} features
 * @returns {Map<string, object>}
 */
function buildFeatureByRef(features) {
  const byRef = new Map()
  if (!Array.isArray(features)) {
    return byRef
  }
  const duplicated = new Set()
  for (const feature of features) {
    const ref = normaliseRef(feature?.ref)
    if (ref === null) {
      continue
    }
    if (byRef.has(ref)) {
      duplicated.add(ref)
    } else {
      byRef.set(ref, feature)
    }
  }
  for (const ref of duplicated) {
    byRef.delete(ref)
  }
  return byRef
}

/**
 * Move one identity field from the baseline document onto a post-intervention
 * feature's baseline sub-object.
 *
 * A Retained feature's proposed identity is a copy of its baseline, made at
 * extract time by copyRetainedProposedFromBaseline when the Proposed columns
 * were blank. A proposed value that still equals the one being replaced is that
 * copy, so it moves too; one that had already diverged came from the GeoPackage
 * and is left exactly as imported.
 *
 * @param {object} feature post-intervention feature, mutated
 * @param {object} source matching baseline feature
 * @param {string} field
 * @param {boolean} proposedTracksBaseline
 * @returns {boolean} whether anything changed
 */
function syncIdentityField(feature, source, field, proposedTracksBaseline) {
  if (!Object.hasOwn(source, field)) {
    return false
  }
  const previous = feature.baseline[field]
  const next = source[field]
  if (previous === next) {
    return false
  }
  feature.baseline[field] = next
  if (proposedTracksBaseline && feature.proposed?.[field] === previous) {
    feature.proposed[field] = next
  }
  return true
}

/**
 * @param {object} feature post-intervention feature, mutated
 * @param {object} source matching baseline feature
 * @param {readonly string[]} fields
 * @returns {boolean} whether anything changed
 */
function syncFeatureIdentity(feature, source, fields) {
  if (!feature.baseline) {
    return false
  }
  const proposedTracksBaseline =
    resolveRetentionCategory(feature) === RETENTION_RETAINED
  let changed = false
  for (const field of fields) {
    changed =
      syncIdentityField(feature, source, field, proposedTracksBaseline) ||
      changed
  }
  return changed
}

/**
 * A Created feature is new habitat, so having no baseline counterpart is the
 * normal case and not worth a log line. A Retained or Enhanced one describes a
 * baseline feature that should be there.
 *
 * @param {object} feature
 * @param {string} layer
 * @param {string | null} ref
 * @param {{ warn: (msg: string) => void }} logger
 */
function warnIfBaselineExpected(feature, layer, ref, logger) {
  if (resolveRetentionCategory(feature) === RETENTION_CREATED) {
    return
  }
  logger.warn(
    `${LOG_PREFIX}${layer} featureId ${feature?.featureId ?? 'unknown'}: no baseline feature for ref "${ref ?? ''}", baseline values left as imported`
  )
}

/**
 * @param {object[]} features post-intervention features for one layer, mutated
 * @param {Map<string, object>} sourceByRef
 * @param {{ layer: string, fields: readonly string[], logger: object }} context
 * @returns {number} how many features changed
 */
function resyncLayer(features, sourceByRef, { layer, fields, logger }) {
  let changed = 0
  for (const feature of features) {
    const ref = normaliseRef(feature?.ref)
    const source = ref === null ? undefined : sourceByRef.get(ref)
    if (source) {
      if (syncFeatureIdentity(feature, source, fields)) {
        changed += 1
      }
    } else {
      warnIfBaselineExpected(feature, layer, ref, logger)
    }
  }
  return changed
}

/**
 * Bring every post-intervention feature's `baseline` sub-object back into step
 * with the project's baseline document. Mutates `postInterventionDocument`.
 *
 * Walks every feature rather than only the one just edited, so a document that
 * had already drifted is repaired by the next edit rather than staying wrong.
 *
 * @param {object} postInterventionDocument
 * @param {object | undefined} baselineDocument
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {number} how many features changed
 */
export function resyncPostInterventionBaselineSide(
  postInterventionDocument,
  baselineDocument,
  logger = NO_OP_LOGGER
) {
  let changed = 0
  for (const [layer, fields] of Object.entries(IDENTITY_FIELDS_BY_LAYER)) {
    const features = postInterventionDocument?.[layer]
    if (!Array.isArray(features) || features.length === 0) {
      continue
    }
    changed += resyncLayer(
      features,
      buildFeatureByRef(baselineDocument?.[layer]),
      {
        layer,
        fields,
        logger
      }
    )
  }
  return changed
}

/**
 * Produce the post-intervention document this project would have if its
 * post-intervention GeoPackage were uploaded again against the supplied
 * baseline: the baseline sub-objects re-synced, then every derived figure
 * recomputed through the same enrichment the upload runs.
 *
 * Returns a new document — the caller's stored one is not mutated — or null
 * when the project has no post-intervention document to re-derive.
 *
 * The enrichment loops every feature through the engine, the same inline pass
 * an upload performs (see the perf evidence in save-upload-for-project.js). An
 * edit already holds the project row lock while it runs, and the whole document
 * is rewritten rather than patched, so this is proportionate to an edit, not to
 * a page render.
 *
 * @param {object | null | undefined} postInterventionDocument as stored
 * @param {object} baselineDocument the updated baseline
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {object | null}
 */
export function rederivePostInterventionFromBaseline(
  postInterventionDocument,
  baselineDocument,
  logger = NO_OP_LOGGER
) {
  if (!postInterventionDocument) {
    return null
  }
  const rederived = structuredClone(postInterventionDocument)
  resyncPostInterventionBaselineSide(rederived, baselineDocument, logger)
  enrichPostInterventionDocumentWithUnits(
    rederived,
    logger,
    postInterventionEnrichOptions(baselineDocument)
  )
  return rederived
}
