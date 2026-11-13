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
// A baseline edit can rename a feature's ref (BMD-1061). The row resolved to it
// takes the new ref too, so the join holds after the rename.
//
// A BNG Service template upload names each row's baseline parent by
// `parentFeatureId` (BMD-1083), so its rows re-sync from that parent and
// nothing else: refs are labels there, not the join, so a row with no parent
// re-syncs from nothing, and a baseline rename leaves its rows' refs alone.
// Its kept trees then take their parent's identity again, priced for their
// own Count (tree-lineage.js).
//
// In a legacy upload, reference-edited Created areas, hedgerows and watercourses retain their
// explicit parent independently of their editable ref; null explicitly means no
// parent. Other legacy rows use `ref` — the Parcel Ref / Tree Ref column — for the same
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
// Upload allows a repeated Parcel Ref on every layer (BMD-1058): duplicate
// parcel refs are legitimate where parcels combine or split. So the ambiguous
// case can arise on the area layer, the one that decides the Met / Not-met
// verdict; the resolution above is what keeps the verdict safe.

import { enforceRequiredAttributeCompleteness } from '../shared/required-attribute-completeness.js'
import { normaliseRef } from '../../../validation/geopackage/carry-forward-feature-ids.js'
import { PARENT_LINKED_LAYERS } from '../../../validation/geopackage/service-template/lineage/link-parents.js'
import {
  PROP_KEYS,
  pickProp
} from '../../../validation/geopackage/properties.js'
import { NO_OP_LOGGER } from '../shared/enrich-units-shared.js'
import {
  RETAINED_AREA_PROPOSED_FIELDS,
  RETAINED_HEDGEROW_PROPOSED_FIELDS,
  RETAINED_TREE_PROPOSED_FIELDS,
  RETAINED_WATERCOURSE_PROPOSED_FIELDS
} from './copy-retained-proposed-from-baseline.js'
import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import {
  applyLineageOutcomes,
  isTemplateUpload,
  restoreUploadedWatercourseAdvance
} from './lineage-outcomes.js'
import { postInterventionEnrichOptions } from './post-intervention-enrich-options.js'
import {
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  isLegacyLostLinear,
  resolveRetentionCategory,
  withRootRetentionCategory
} from './retention-category.js'

const LOG_PREFIX = 'resyncPostInterventionBaseline: '

const STRATEGIC_SIGNIFICANCE_FIELD = 'strategicSignificance'

/**
 * The fields that say *what a feature is*, as opposed to the scores enrichment
 * derives from them. This is the same set the retained-proposed copy uses, and
 * deliberately shares its lists: a column that identifies a habitat on one side
 * identifies it on the other, so a new one is added in a single place.
 *
 * A baseline tree is editable (BMD-1112), but only its condition, reference
 * and comment: `recomputeTreeEdit` pins the urban/rural habitat type and the
 * size class and count are read-only, so the only identity field an edit can
 * move is the condition, which the re-derive carries across like any other.
 */
const IDENTITY_FIELDS_BY_LAYER = Object.freeze({
  habitats: RETAINED_AREA_PROPOSED_FIELDS,
  verticalHabitats: RETAINED_AREA_PROPOSED_FIELDS,
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
 * Whether two sides carry the same strategic significance. Every baseline side
 * is stored as Low (BMD-1086), so the stored value no longer tells apart two
 * rows that share a ref and differ only in significance; the value each file
 * gave, kept in the raw `properties`, still does. Only when both features keep
 * their raw properties are those compared, so a file value is never set
 * against a stored one; otherwise the stored values are.
 *
 * @param {object} candidate a feature from the PRE-EDIT baseline document
 * @param {object} feature the post-intervention row
 * @param {object} snapshot the row's `baseline` sub-object
 * @returns {boolean}
 */
function sameStrategicSignificance(candidate, feature, snapshot) {
  if (candidate.properties && feature.properties) {
    return (
      pickProp(candidate.properties, PROP_KEYS.strategicSignificance) ===
      pickProp(feature.properties, PROP_KEYS.strategicSignificance)
    )
  }
  return candidate.strategicSignificance === snapshot.strategicSignificance
}

/**
 * Whether a pre-edit baseline feature is the one a post-intervention row's
 * imported `baseline` snapshot describes. Only the fields the candidate carries
 * are compared — they are the only ones that would ever be copied from it.
 * Strategic significance is compared as imported, not as stored.
 *
 * @param {object} candidate a feature from the PRE-EDIT baseline document
 * @param {object} feature the post-intervention row
 * @param {readonly string[]} fields
 * @returns {boolean}
 */
function matchesSnapshot(candidate, feature, fields) {
  const snapshot = feature.baseline ?? {}
  return fields.every((field) => {
    if (!Object.hasOwn(candidate, field)) {
      return true
    }
    if (field === STRATEGIC_SIGNIFICANCE_FIELD) {
      return sameStrategicSignificance(candidate, feature, snapshot)
    }
    return candidate[field] === snapshot[field]
  })
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
  const matches = candidates.filter((candidate) =>
    matchesSnapshot(candidate, feature, fields)
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
 * Strategic significance is never copied. A baseline edit cannot change it, so
 * copying it could only carry a value saved before BMD-1086 (the file's, such
 * as High) onto a row saved since, whose baseline side is Low. It still
 * identifies the source row (see `sameStrategicSignificance`).
 *
 * @param {object} feature post-intervention feature, mutated
 * @param {object} source matching baseline feature
 * @param {string} field
 * @param {boolean} proposedTracksBaseline
 * @returns {boolean} whether anything changed
 */
function syncIdentityField(feature, source, field, proposedTracksBaseline) {
  if (field === STRATEGIC_SIGNIFICANCE_FIELD || !Object.hasOwn(source, field)) {
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
 * Carry a renamed baseline ref onto the post-intervention row resolved to it
 * (BMD-1061). The ref is the join key between the two documents, so a row left
 * on the old ref would lose its baseline parcel on the next edit and the
 * linear baseline lengths would stop finding it. Rows that could not be
 * resolved keep their ref — see `resolveBaselineFeature`.
 *
 * Resolution runs on the pre-edit baseline, so the row's ref always matched its
 * source before the edit; a difference now can only be the edit's rename.
 *
 * @param {object} feature post-intervention feature, mutated
 * @param {object} source matching post-edit baseline feature
 * @returns {boolean} whether the ref changed
 */
function syncRef(feature, source) {
  if (isJoinedByEditedRef(feature)) {
    return false
  }
  const next = normaliseRef(source.ref)
  if (next === null || next === normaliseRef(feature.ref)) {
    return false
  }
  feature.ref = next
  return true
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
export const UNRESOLVED_REASONS = Object.freeze({
  missing: (ref) => `no baseline feature carries ref "${ref ?? ''}"`,
  parentMissing: (ref) => `the baseline holds no parent for row "${ref ?? ''}"`,
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
 * Whether a post-intervention row's own edit page renames it: a Created
 * feature's, and an Enhanced individual tree's. A Retained row is renamed
 * through its baseline parcel instead (apply-retained-ref-edit.js).
 *
 * @param {object} feature
 * @param {string} layer its post-intervention document key
 * @returns {boolean}
 */
function isRenamedOnItsOwnPage(feature, layer) {
  const retention = resolveRetentionCategory(feature)
  return (
    retention === RETENTION_CREATED ||
    (retention === RETENTION_ENHANCED && layer === 'trees')
  )
}

/**
 * Whether a row renamed on its own page is joined to its baseline feature by
 * the parent recorded when it was renamed, rather than by its ref. Only such a
 * row is marked `referenceEdited` (preserveCreatedParent): a Created one, or
 * an Enhanced tree.
 *
 * @param {object} feature
 * @returns {boolean}
 */
function isJoinedByEditedRef(feature) {
  const retention = resolveRetentionCategory(feature)
  return (
    feature.referenceEdited === true &&
    (retention === RETENTION_CREATED || retention === RETENTION_ENHANCED)
  )
}

/**
 * Preserve lineage before an editable Created reference, or an Enhanced
 * tree's, changes its join key.
 *
 * A BNG Service template row's parent is the one its file named, kept as
 * `parentFeatureId` whatever its ref (BMD-1083). One that names none has no
 * parent, so renaming it must not find one by its old ref: with
 * `serviceTemplate`, only the rename is recorded.
 */
export function preserveCreatedParent(
  existing,
  updated,
  { documentKey, layer, baseline, serviceTemplate = false }
) {
  const ownPageEdit =
    documentKey === 'postIntervention' &&
    ['habitats', 'trees', 'hedgerows', 'watercourses'].includes(layer)
  if (
    !ownPageEdit ||
    !isRenamedOnItsOwnPage(existing, layer) ||
    updated.ref === existing.ref
  ) {
    return
  }
  updated.referenceEdited = true
  if (serviceTemplate || Object.hasOwn(existing, 'parentFeatureId')) {
    return
  }
  const candidates =
    buildBaselineCandidatesByRef(baseline).get(normaliseRef(existing.ref)) ?? []
  const resolved = resolveBaselineFeature(
    candidates,
    existing,
    IDENTITY_FIELDS_BY_LAYER[layer]
  )
  updated.parentFeatureId = resolved.source?.featureId ?? null
}

/**
 * The post-edit baseline feature a row names by `parentFeatureId`, or why it
 * cannot be had.
 *
 * @param {object} feature
 * @param {Map<string, object>} updatedById
 * @param {'parentMissing' | 'missing'} reason
 * @returns {{ source: object } | { unresolvable: string, ref: string | null, candidateCount: number }}
 */
function resolveByParent(feature, updatedById, reason) {
  const source = updatedById.get(feature.parentFeatureId)
  return source
    ? { source }
    : {
        unresolvable: reason,
        ref: normaliseRef(feature.ref),
        candidateCount: 0
      }
}

/**
 * The post-edit baseline feature a row describes, found by its ref on the
 * pre-edit baseline, or why it cannot be had.
 *
 * @param {object} feature
 * @param {{ candidatesByRef: Map<string, object[]>, updatedById: Map<string, object>, fields: readonly string[] }} index
 * @returns {{ source: object } | { unresolvable: string, ref: string | null, candidateCount: number }}
 */
function resolveByRef(feature, { candidatesByRef, updatedById, fields }) {
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
 * Resolve one post-intervention row to the post-edit baseline feature it should
 * take its values from, or say why it cannot be resolved.
 *
 * @param {object} feature
 * @param {{ candidatesByRef: Map<string, object[]>, updatedById: Map<string, object>, fields: readonly string[], byParent: boolean }} index
 *   `byParent` for a layer a BNG Service template upload links to its parents
 * @returns {{ source: object } | { unresolvable: string, ref: string | null, candidateCount: number }}
 */
function resolveSource(feature, index) {
  if (index.byParent) {
    return resolveByParent(feature, index.updatedById, 'parentMissing')
  }
  if (isJoinedByEditedRef(feature)) {
    return resolveByParent(feature, index.updatedById, 'missing')
  }
  return resolveByRef(feature, index)
}

/**
 * The baseline feature a post-intervention row is joined to, resolved exactly
 * as the re-derive resolves it, against the baseline as it stands, so a row
 * this finds a source for is a row the re-derive will carry a rename onto.
 *
 * By default the row is joined by its ref, as a legacy row is, for an edit
 * that starts on the post-intervention side (BMD-1180). With `templateUpload`,
 * a row of a BNG Service template upload is joined by the parent its file
 * named (BMD-1083), as the re-derive joins it — used to read a Retained
 * habitat's baseline comment (BMD-1187).
 *
 * @param {object} feature post-intervention feature
 * @param {string} layer document layer: habitats, verticalHabitats, trees, hedgerows or watercourses
 * @param {object | undefined} baseline the project's baseline document, or at
 *   least its `layer`
 * @param {{ templateUpload?: boolean }} [options]
 * @returns {{ source: object } | { unresolvable: string, ref: string | null, candidateCount: number }}
 */
export function resolveJoinedBaselineFeature(
  feature,
  layer,
  baseline,
  { templateUpload = false } = {}
) {
  const features = baseline?.[layer]
  return resolveSource(feature, {
    candidatesByRef: buildBaselineCandidatesByRef(features),
    updatedById: buildFeatureById(features),
    fields: IDENTITY_FIELDS_BY_LAYER[layer] ?? [],
    byParent: templateUpload && PARENT_LINKED_LAYERS.includes(layer)
  })
}

/**
 * @param {object[]} features post-intervention features for one layer, mutated
 * @param {{ candidatesByRef: Map<string, object[]>, updatedById: Map<string, object>, fields: readonly string[], byParent: boolean }} index
 * @param {{ layer: string, logger: object }} context
 * @returns {number} how many features changed
 */
function resyncLayer(features, index, { layer, logger }) {
  let changed = 0
  for (const feature of features) {
    const resolved = resolveSource(feature, index)
    if (resolved.source) {
      const identityChanged = syncFeatureIdentity(
        feature,
        resolved.source,
        index.fields
      )
      // A template row's ref is its own label, not the join (BMD-1083).
      const refChanged = !index.byParent && syncRef(feature, resolved.source)
      if (identityChanged || refChanged) {
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
  const templateUpload = isTemplateUpload(postInterventionDocument)
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
        fields,
        byParent: templateUpload && PARENT_LINKED_LAYERS.includes(layer)
      },
      { layer, logger }
    )
  }
  return changed
}

/**
 * Produce the post-intervention document this project would have if its
 * post-intervention GeoPackage were uploaded again against the supplied
 * baseline: the baseline sub-objects re-synced, a BNG Service template
 * upload's lineage outcomes worked out again against it, then every derived
 * figure recomputed through the same enrichment the upload runs.
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
  // A legacy row's category moves to the root, as an upload now writes it,
  // so the re-derived document passes the schema it is written under.
  for (const layer of Object.keys(IDENTITY_FIELDS_BY_LAYER)) {
    if (Array.isArray(rederived[layer])) {
      rederived[layer] = rederived[layer].map(withRootRetentionCategory)
    }
  }
  resyncPostInterventionBaselineSide(
    rederived,
    { baseline, previousBaseline },
    logger
  )
  // What each parent loses depends on its type and size, and whether a
  // watercourse is an encroachment-only change on its condition and
  // encroachment, so both are worked out again before the re-pricing reads
  // the advance (BMD-1083). The check starts from the advance the user
  // uploaded, so an advance an earlier edit nulled comes back once the
  // baseline allows it again.
  if (isTemplateUpload(rederived)) {
    restoreUploadedWatercourseAdvance(rederived)
    applyLineageOutcomes(rederived, baseline, logger)
  }
  enrichPostInterventionDocumentWithUnits(
    rederived,
    logger,
    postInterventionEnrichOptions(baseline)
  )
  // Legacy Lost linear rows have no proposed habitat and remain Complete at
  // zero units. New uploads exclude them, but stored documents may contain them.
  enforceRequiredAttributeCompleteness(
    {
      ...rederived,
      hedgerows: rederived.hedgerows?.filter(
        (feature) => !isLegacyLostLinear(feature)
      ),
      watercourses: rederived.watercourses?.filter(
        (feature) => !isLegacyLostLinear(feature)
      )
    },
    true
  )
  return rederived
}
