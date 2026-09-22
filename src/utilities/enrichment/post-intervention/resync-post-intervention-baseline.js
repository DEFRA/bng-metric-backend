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
// post-intervention row describing it share no id.
//
// A ref is NOT unique. The metric allows several features to share one where
// parcels combine or split, so the join is one-to-many in both directions:
//
//   - One baseline row to many post-intervention rows (a split) is the easy
//     direction: every row naming that ref re-syncs from the one source.
//   - Many baseline rows sharing a ref is the ambiguous one, and the ref alone
//     cannot say which of them a post-intervention row describes.
//
// The tie-break is the row's own `baseline` sub-object — its imported copy of
// its source's Baseline * columns. Crucially it is matched against the baseline
// document as it stood BEFORE the edit, not after: the edit is precisely what
// makes the snapshot disagree with the current values, so matching on those
// could never identify the row the edit is about. Resolution therefore runs on
// the pre-edit document, where the copy still matches exactly, and the values
// are then taken from that same feature's post-edit version — `featureId` is
// stable across an edit within a document.
//
// Only an unambiguous match resolves. No candidate carrying the row's imported
// values means the source cannot be identified; several carrying them means the
// pre-edit rows were indistinguishable and their post-edit versions may not be,
// so choosing between them would be a coin flip. Both are left exactly as
// imported, and logged.
//
// Today `checkDuplicateHabitatRefs` rejects a repeated Parcel Ref on the AREA
// layer at upload, in both variants, so the ambiguous case cannot yet arise on
// the layer that decides the Met / Not-met verdict. That check is understood to
// be wrong — duplicate parcel refs are legitimate where parcels combine or
// split — and is raised separately. Nothing here depends on it: the resolution
// above is what keeps the verdict safe, so relaxing the upload check needs no
// change to this file.

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
 * Group one baseline layer's features by ref. Every feature carrying a ref is
 * kept — a shared ref is legitimate, not a data error — so a ref can map to
 * several candidates. A blank ref identifies nothing and is dropped.
 *
 * @param {object[] | undefined} features
 * @returns {Map<string, object[]>}
 */
function buildBaselineCandidatesByRef(features) {
  const byRef = new Map()
  if (!Array.isArray(features)) {
    return byRef
  }
  for (const feature of features) {
    const ref = normaliseRef(feature?.ref)
    if (ref === null) {
      continue
    }
    const candidates = byRef.get(ref)
    if (candidates) {
      candidates.push(feature)
    } else {
      byRef.set(ref, [feature])
    }
  }
  return byRef
}

/**
 * Whether a pre-edit baseline feature is the one a post-intervention row's
 * imported `baseline` snapshot describes. Only the fields the candidate carries
 * are compared — they are the only ones that would ever be copied from it.
 *
 * @param {object} candidate a feature from the PRE-EDIT baseline document
 * @param {object} snapshot the post-intervention row's `baseline` sub-object
 * @param {readonly string[]} fields
 * @returns {boolean}
 */
function matchesSnapshot(candidate, snapshot, fields) {
  return fields.every(
    (field) =>
      !Object.hasOwn(candidate, field) || candidate[field] === snapshot[field]
  )
}

/**
 * Pick the pre-edit baseline feature a post-intervention row was derived from.
 *
 * A ref carried by one feature is the whole answer. Where several share it, the
 * row's imported snapshot has to identify which, and only a single match will
 * do — several equally-matching pre-edit rows may have diverged by the edit, so
 * picking one would be a guess.
 *
 * @param {object[]} candidates
 * @param {object} feature post-intervention feature
 * @param {readonly string[]} fields
 * @returns {{ source: object } | { unresolvable: 'ambiguous' | 'unidentified' }}
 */
function resolveBaselineFeature(candidates, feature, fields) {
  if (candidates.length === 1) {
    return { source: candidates[0] }
  }
  const snapshot = feature.baseline ?? {}
  const matches = candidates.filter((candidate) =>
    matchesSnapshot(candidate, snapshot, fields)
  )
  if (matches.length === 1) {
    return { source: matches[0] }
  }
  return {
    unresolvable: matches.length > 1 ? 'ambiguous' : 'unidentified'
  }
}

/**
 * Index a document layer by featureId, so a feature resolved against the
 * pre-edit baseline can be read back from the post-edit one.
 *
 * @param {object[] | undefined} features
 * @returns {Map<string, object>}
 */
function buildFeatureById(features) {
  const byId = new Map()
  if (!Array.isArray(features)) {
    return byId
  }
  for (const feature of features) {
    if (feature?.featureId) {
      byId.set(feature.featureId, feature)
    }
  }
  return byId
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
 * Say that a row could not be resolved, and why — a ref nothing carries reads
 * very differently from a shared ref whose candidates none of this row's
 * imported values identify.
 *
 * A Created feature is new habitat: having no baseline counterpart is its
 * normal state, and its baseline snapshot is an "N/A" placeholder that would
 * identify nothing, so neither case is worth a log line. A Retained or Enhanced
 * one describes a baseline feature that should be findable.
 *
 * @param {object} feature
 * @param {{ layer: string, ref: string | null, candidateCount: number, logger: { warn: (msg: string) => void } }} context
 */
const UNRESOLVED_REASONS = Object.freeze({
  missing: (ref) => `no baseline feature carries ref "${ref ?? ''}"`,
  unidentified: (ref, count) =>
    `${count} baseline features share ref "${ref}" and none carries this row's imported baseline values`,
  ambiguous: (ref, count) =>
    `${count} baseline features share ref "${ref}" and more than one carries this row's imported baseline values, so which one the edit moved cannot be told`
})

function warnUnresolved(
  feature,
  { layer, ref, reason, candidateCount, logger }
) {
  if (resolveRetentionCategory(feature) === RETENTION_CREATED) {
    return
  }
  logger.warn(
    `${LOG_PREFIX}${layer} featureId ${feature?.featureId ?? 'unknown'}: ${UNRESOLVED_REASONS[reason](ref, candidateCount)}, baseline values left as imported`
  )
}

/**
 * Resolve one post-intervention row to the post-edit baseline feature it should
 * take its values from, or say why it cannot be resolved.
 *
 * @param {object} feature
 * @param {{ candidatesByRef: Map<string, object[]>, updatedById: Map<string, object>, fields: readonly string[] }} index
 * @returns {{ source: object } | { unresolvable: string, ref: string | null, candidateCount: number }}
 */
function resolveSource(feature, { candidatesByRef, updatedById, fields }) {
  const ref = normaliseRef(feature?.ref)
  const candidates = (ref === null ? undefined : candidatesByRef.get(ref)) ?? []
  if (candidates.length === 0) {
    return { unresolvable: 'missing', ref, candidateCount: 0 }
  }
  const resolved = resolveBaselineFeature(candidates, feature, fields)
  if (resolved.unresolvable) {
    return {
      unresolvable: resolved.unresolvable,
      ref,
      candidateCount: candidates.length
    }
  }
  // Resolution ran on the pre-edit document; the values come from the same
  // feature as it stands now.
  const updated = updatedById.get(resolved.source.featureId)
  if (!updated) {
    return { unresolvable: 'missing', ref, candidateCount: candidates.length }
  }
  return { source: updated }
}

/**
 * @param {object[]} features post-intervention features for one layer, mutated
 * @param {{ candidatesByRef: Map<string, object[]>, updatedById: Map<string, object>, fields: readonly string[] }} index
 * @param {{ layer: string, logger: object }} context
 * @returns {number} how many features changed
 */
function resyncLayer(features, index, { layer, logger }) {
  let changed = 0
  for (const feature of features) {
    const resolved = resolveSource(feature, index)
    if (resolved.source) {
      if (syncFeatureIdentity(feature, resolved.source, index.fields)) {
        changed += 1
      }
    } else {
      warnUnresolved(feature, {
        layer,
        ref: resolved.ref,
        reason: resolved.unresolvable,
        candidateCount: resolved.candidateCount,
        logger
      })
    }
  }
  return changed
}

/**
 * Bring every post-intervention feature's `baseline` sub-object back into step
 * with the project's baseline document. Mutates `postInterventionDocument`.
 *
 * Walks every feature rather than only the one just edited, so a row left
 * behind by an earlier edit is brought back into step by the next one.
 *
 * @param {object} postInterventionDocument
 * @param {object} documents
 * @param {object} [documents.baseline] the baseline as it now stands
 * @param {object} [documents.previousBaseline] the baseline as it stood before
 *   the edit; only consulted to break a tie between features sharing a ref
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {number} how many features changed
 */
export function resyncPostInterventionBaselineSide(
  postInterventionDocument,
  { baseline, previousBaseline = baseline },
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
      {
        candidatesByRef: buildBaselineCandidatesByRef(
          previousBaseline?.[layer]
        ),
        updatedById: buildFeatureById(baseline?.[layer]),
        fields
      },
      { layer, logger }
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
 * @param {object} documents
 * @param {object} documents.baseline the baseline as it now stands
 * @param {object} [documents.previousBaseline] the baseline as it stood before
 *   the edit, used only to identify which of several features sharing a ref a
 *   post-intervention row describes. Defaults to `baseline`, which resolves
 *   every unambiguous ref and is all a caller with no edit to speak of has.
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {object | null}
 */
export function rederivePostInterventionFromBaseline(
  postInterventionDocument,
  { baseline, previousBaseline },
  logger = NO_OP_LOGGER
) {
  if (!postInterventionDocument) {
    return null
  }
  const rederived = structuredClone(postInterventionDocument)
  resyncPostInterventionBaselineSide(
    rederived,
    { baseline, previousBaseline },
    logger
  )
  enrichPostInterventionDocumentWithUnits(
    rederived,
    logger,
    postInterventionEnrichOptions(baseline)
  )
  return rederived
}
