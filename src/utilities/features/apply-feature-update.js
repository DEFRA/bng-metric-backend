import { recomputeCreatedWatercourseEdit } from '../../validation/geopackage/post-intervention/recompute-created-watercourse-edit.js'
// Single entry point for "user edited a project feature, persist the new
// derived shape." Used by baseline and post-intervention PUT routes. Pure —
// does no I/O. Callers wrap the result in their own transaction and write the
// project document back.
//
// Producing the updated feature set goes through one path so:
//
//   - every feature type carries the same persisted derived shape
//     (distinctiveness / distinctivenessScore / conditionScore / units /
//     status), avoiding the kind of write-path drift that left BMD-480
//     writing `habitatUnits` while everything else reads `units`,
//   - per-feature totals always refresh after an edit
//     (the BMD-480 area route shipped without this and the habitat-list
//     summary header went stale after a save),
//   - an edit to one document refreshes whatever the other derived from it —
//     the post-intervention document keeps its own copy of the baseline, so a
//     baseline edit re-derives it (resync-post-intervention-baseline.js), and
//   - adding a new feature type later means adding one recompute function,
//     not a new persistence path.

import { recomputeCreatedHedgerowEdit } from '../../validation/geopackage/post-intervention/recompute-created-hedgerow-edit.js'
import { recomputeCreatedAreaEdit } from '../../validation/geopackage/post-intervention/recompute-created-area-edit.js'
import {
  recomputeAreaHabitat,
  recomputeHedgerow,
  recomputeWatercourse
} from '../../validation/geopackage/unit-calculation.js'
import { OUT_OF_SCOPE_BANDS } from '../../validation/geopackage/distinctiveness-check.js'
import { cleanComment } from '../../validation/geopackage/comment-check.js'
import { cleanHabitatRef } from '../../validation/geopackage/habitat-ref-check.js'
import { recomputePostInterventionAreaHabitat } from '../../validation/geopackage/post-intervention/recompute-post-intervention-area-habitat.js'
import { recomputePostInterventionHedgerow } from '../../validation/geopackage/post-intervention/recompute-post-intervention-hedgerow.js'
import { checkFeatureEnhancement } from '../../validation/geopackage/post-intervention/enhancement-rules.js'
import {
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import { postInterventionEnrichOptions } from '../enrichment/post-intervention/post-intervention-enrich-options.js'
import { isTemplateUpload } from '../enrichment/post-intervention/lineage-outcomes.js'
import {
  copyProposedDisplayFields,
  copyProposedEngineMetrics
} from '../enrichment/shared/proposed-enrichment-fields.js'

import { preserveCreatedParent } from '../enrichment/post-intervention/resync-post-intervention-baseline.js'
import { NO_OP_LOGGER } from '../enrichment/shared/enrich-units-shared.js'
import { refreshFiguresDownstreamOfEdit } from './refresh-edit-figures.js'
import { findFeature } from './find-feature.js'
import { renameClashes } from './ref-in-use.js'
import {
  VERTICAL_BROAD_HABITATS,
  isVerticalHabitat
} from '../../validation/reference/vertical-habitats.js'
import { keepsTreeATree, withEditedTreeSizes } from './tree-edit.js'

/**
 * Outcome codes for callers. `featureWrongType` distinguishes "the URL
 * promised an area habitat but the featureId points at a hedgerow" from
 * "feature does not exist" so legacy typed routes can keep returning 404 for
 * cross-layer access.
 */
const APPLY_RESULT = Object.freeze({
  OK: 'ok',
  FEATURE_NOT_FOUND: 'featureNotFound',
  FEATURE_WRONG_TYPE: 'featureWrongType',
  UNSUPPORTED_TYPE: 'unsupportedType',
  OUT_OF_SCOPE: 'outOfScope',
  INVALID_ENHANCEMENT: 'invalidEnhancement',
  REF_IN_USE: 'refInUse'
})

function blankToNull(value) {
  if (value === null || value === undefined) {
    return null
  } else {
    const trimmed = typeof value === 'string' ? value.trim() : value
    if (trimmed === '') {
      return null
    } else {
      return trimmed
    }
  }
}

/**
 * The edited ref as it is stored, or undefined when the edit leaves the ref
 * alone. Unlike the dropdown fields, an absent ref is not a request to clear
 * it: a habitat must always have one (BMD-1058), and baseline renaming (BMD-1061) and full Created-area edits
 * send it. The route has already refused a blank one.
 *
 * @param {unknown} ref
 * @returns {string | undefined}
 */
function normalizeRef(ref) {
  if (ref === undefined || ref === null) {
    return undefined
  }
  const cleaned = cleanHabitatRef(ref)
  return cleaned === '' ? undefined : cleaned
}

/**
 * The edited comment as it is stored, or undefined when the edit leaves it
 * alone. An absent comment is not a request to clear it. Blank and
 * whitespace-only become null.
 *
 * @param {object} edits
 * @returns {string | null | undefined}
 */
function normalizeComment(edits) {
  if (!Object.hasOwn(edits, 'comment')) {
    return undefined
  }
  return cleanComment(edits.comment)
}

function normalizeEdits(edits = {}) {
  return {
    ref: normalizeRef(edits.ref),
    ...(Object.hasOwn(edits, 'advanceYears')
      ? {
          strategicSignificance:
            edits.strategicSignificance === undefined
              ? undefined
              : blankToNull(edits.strategicSignificance),
          advanceYears: edits.advanceYears,
          delayYears: edits.delayYears
        }
      : {}),
    broadType: blankToNull(edits.broadType),
    habitatType: blankToNull(edits.habitatType),
    condition: blankToNull(edits.condition),
    watercourseEncroachment: blankToNull(edits.watercourseEncroachment),
    riparianEncroachment: blankToNull(edits.riparianEncroachment),
    comment: normalizeComment(edits)
  }
}

function recomputeHabitatEdit(existing, edits, { documentKey, logger }) {
  if (documentKey === 'postIntervention') {
    if (Object.hasOwn(edits, 'advanceYears')) {
      return recomputeCreatedAreaEdit(existing, edits)
    }
    return recomputePostInterventionAreaHabitat(
      existing,
      {
        broadType: edits.broadType,
        habitatType: edits.habitatType,
        condition: edits.condition
      },
      logger
    )
  }
  return recomputeAreaHabitat({
    broadType: edits.broadType,
    habitatType: edits.habitatType,
    condition: edits.condition,
    sizeSquareMetres: existing.sizeSquareMetres ?? existing.area ?? null
  })
}

function recomputeHedgerowEdit(
  existing,
  edits,
  { documentKey, logger, baseline }
) {
  if (documentKey === 'postIntervention') {
    if (Object.hasOwn(edits, 'advanceYears')) {
      return recomputeCreatedHedgerowEdit(existing, edits)
    }
    return recomputePostInterventionHedgerow(
      existing,
      { habitatType: edits.habitatType, condition: edits.condition },
      {
        baselineLengthByRef:
          postInterventionEnrichOptions(baseline).baselineLengthByRef,
        logger
      }
    )
  }
  return recomputeHedgerow({
    habitatType: edits.habitatType,
    condition: edits.condition,
    sizeMetres: existing.sizeMetres ?? null
  })
}

function recomputeWatercourseEdit(existing, edits, { documentKey }) {
  if (documentKey === 'postIntervention') {
    return Object.hasOwn(edits, 'advanceYears')
      ? recomputeCreatedWatercourseEdit(existing, edits)
      : null
  }
  return recomputeWatercourse({
    habitatType: edits.habitatType,
    condition: edits.condition,
    watercourseEncroachment: edits.watercourseEncroachment,
    riparianEncroachment: edits.riparianEncroachment,
    sizeMetres: existing.sizeMetres ?? null
  })
}

/**
 * A baseline vertical area habitat is edited as an area habitat, sized by its
 * typed area, but stays one of the habitats the Metric counts by vertical
 * area: an edit to any other, or to another broad habitat with the habitat
 * type left blank, is turned away. A post-intervention one is not
 * editable yet.
 */
function recomputeVerticalHabitatEdit(existing, edits, context) {
  if (context.documentKey === 'postIntervention') {
    return null
  }
  const leavesVertical =
    edits.habitatType === null
      ? edits.broadType !== null &&
        !VERTICAL_BROAD_HABITATS.includes(edits.broadType)
      : !isVerticalHabitat(edits.broadType, edits.habitatType)
  if (leavesVertical) {
    return null
  }
  return recomputeHabitatEdit(existing, edits, context)
}

/**
 * An individual tree is edited as an area habitat (BMD-1112). Its size is
 * notional — the per-size reference area times the number of trees the point
 * stands for (tree-sizes.js) — and the details page shows the size class and
 * count read-only, so an edit moves its condition, setting, reference or
 * comment and never its area. It stays a tree (tree-edit.js), and a change of
 * setting moves it between the urban and rural sizes (withEditedTreeSizes).
 *
 * After intervention only a Created tree is edited this way, with the Created
 * area habitat edit's complete payload; a Retained tree's reference
 * is renamed through apply-retained-ref-edit.js, and an Enhanced tree, like an
 * Enhanced area habitat, is not editable.
 */
function recomputeTreeEdit(existing, edits, context) {
  if (!keepsTreeATree(existing, edits, context.documentKey)) {
    return null
  }
  if (context.documentKey === 'postIntervention') {
    return Object.hasOwn(edits, 'advanceYears')
      ? recomputeCreatedAreaEdit(existing, edits)
      : null
  }
  return recomputeHabitatEdit(existing, edits, context)
}

const RECOMPUTE_EDIT_BY_TYPE = Object.freeze({
  habitat: recomputeHabitatEdit,
  verticalHabitat: recomputeVerticalHabitatEdit,
  tree: recomputeTreeEdit,
  hedgerow: recomputeHedgerowEdit,
  watercourse: recomputeWatercourseEdit
})

function recomputeForType(type, existing, edits, context) {
  return Object.hasOwn(RECOMPUTE_EDIT_BY_TYPE, type)
    ? RECOMPUTE_EDIT_BY_TYPE[type](existing, edits, context)
    : null
}

function mergeBaselineFeature(type, existing, edits, derived) {
  const base = {
    ...existing,
    ...(edits.ref === undefined ? {} : { ref: edits.ref }),
    // Omitted when the edit did not send a comment, so the stored one stays.
    ...(edits.comment === undefined ? {} : { comment: edits.comment }),
    condition: edits.condition,
    distinctiveness: derived.distinctiveness,
    distinctivenessScore: derived.distinctivenessScore,
    conditionScore: derived.conditionScore,
    units: derived.units,
    status: derived.status
  }
  if (type === 'habitat' || type === 'verticalHabitat' || type === 'tree') {
    return { ...base, broadType: edits.broadType, type: edits.habitatType }
  } else if (type === 'watercourse') {
    return {
      ...base,
      type: edits.habitatType,
      watercourseEncroachment: edits.watercourseEncroachment,
      riparianEncroachment: edits.riparianEncroachment,
      waterEncroachmentMultiplier: derived.waterEncroachmentMultiplier ?? null,
      riparianEncroachmentMultiplier:
        derived.riparianEncroachmentMultiplier ?? null
    }
  } else {
    return { ...base, type: edits.habitatType }
  }
}

function mergePostInterventionFeature(type, existing, edits, derived) {
  const updatedProposed = {
    ...existing.proposed,
    condition: edits.condition,
    distinctiveness: derived.distinctiveness,
    distinctivenessScore: derived.distinctivenessScore,
    conditionScore: derived.conditionScore
  }
  copyProposedEngineMetrics(updatedProposed, derived)
  copyProposedDisplayFields(updatedProposed, derived)
  if (type === 'habitat') {
    updatedProposed.broadType = edits.broadType
    updatedProposed.type = edits.habitatType
  } else {
    updatedProposed.type = edits.habitatType
  }
  return {
    ...existing,
    units: derived.units,
    status: derived.status,
    proposed: updatedProposed
  }
}

function mergeFeature(type, existing, edits, derived, documentKey) {
  if (documentKey === 'postIntervention') {
    return mergePostInterventionFeature(type, existing, edits, derived)
  } else {
    return mergeBaselineFeature(type, existing, edits, derived)
  }
}

function spliceFeatureInFeatureSet(
  featureSet,
  layerKey,
  index,
  updatedFeature
) {
  const layer = featureSet[layerKey]
  const updatedLayer = layer.slice()
  updatedLayer[index] = updatedFeature
  return {
    ...featureSet,
    [layerKey]: updatedLayer
  }
}

/**
 * An edited post-intervention feature no longer carries the rule its import
 * broke: the edit replaced the proposed values that broke it, and was checked
 * against the rules itself (`brokenEnhancementRule`).
 *
 * @param {object} feature
 * @param {string} documentKey
 * @returns {object}
 */
function withoutImportedRejection(feature, documentKey) {
  if (
    documentKey !== 'postIntervention' ||
    !('invalidEnhancement' in feature)
  ) {
    return feature
  }
  const cleared = { ...feature }
  delete cleared.invalidEnhancement
  return cleared
}

function resolveUpdatedFeature(
  found,
  edits,
  derived,
  { documentKey, baseline, serviceTemplate }
) {
  const recomputedWholeFeature =
    documentKey === 'postIntervention' &&
    CREATED_EDIT_TYPES.has(found.type) &&
    derived.updatedFeature
  const updated = recomputedWholeFeature
    ? derived.updatedFeature
    : mergeFeature(found.type, found.feature, edits, derived, documentKey)
  preserveCreatedParent(found.feature, updated, {
    documentKey,
    layer: found.key,
    baseline,
    serviceTemplate
  })
  return withoutImportedRejection(updated, documentKey)
}

/**
 * The fully-rebuilt project document, carrying the re-derived post-intervention
 * subtree when a baseline edit produced one.
 *
 * @param {object} project
 * @param {string} documentKey
 * @param {object} updatedFeatureSet
 * @param {object | null} postIntervention
 * @returns {object}
 */
function rebuiltProject(
  project,
  documentKey,
  updatedFeatureSet,
  postIntervention
) {
  const rebuilt = { ...project, [documentKey]: updatedFeatureSet }
  if (postIntervention) {
    rebuilt.postIntervention = postIntervention
  }
  return rebuilt
}

/**
 * The enhancement rule an edit to an enhanced post-intervention feature
 * breaks, or null. An edit must leave a valid enhancement of the feature's
 * baseline, as an import must (reject-invalid-enhancements.js); unlike an
 * import, it is refused rather than saved with its proposed values nulled.
 * The edit replaces only some proposed fields, so the check runs on the
 * recomputed feature, which carries all of them.
 *
 * @param {{ key: string }} found
 * @param {{ updatedFeature?: object }} derived
 * @param {string} documentKey
 * @returns {string | null} one of bng-library's ENHANCEMENT_RULE
 */
function brokenEnhancementRule(found, derived, documentKey) {
  const feature = derived.updatedFeature
  if (
    documentKey !== 'postIntervention' ||
    !feature ||
    resolveRetentionCategory(feature) !== RETENTION_ENHANCED
  ) {
    return null
  }
  const check = checkFeatureEnhancement(found.key, feature)
  return check && !check.valid ? check.rule : null
}

// The post-intervention features a Created edit's complete payload reaches:
// area habitats and trees, which carry a broad habitat, and hedgerows and
// watercourses, which do not.
const CREATED_EDIT_TYPES = new Set([
  'habitat',
  'tree',
  'hedgerow',
  'watercourse'
])
const BROAD_HABITAT_TYPES = new Set(['habitat', 'tree'])

function hasUnsupportedTimingEdit(found, edits, documentKey) {
  const unsupportedLinearBroadType =
    !BROAD_HABITAT_TYPES.has(found.type) && edits.broadType !== null
  return (
    documentKey === 'postIntervention' &&
    Object.hasOwn(edits, 'advanceYears') &&
    (!CREATED_EDIT_TYPES.has(found.type) ||
      unsupportedLinearBroadType ||
      resolveRetentionCategory(found.feature) !== RETENTION_CREATED ||
      edits.ref === undefined)
  )
}

/**
 * Whether a baseline edit renames its feature onto a reference another
 * baseline habitat already carries (ref-in-use.js). Post-intervention edits
 * ignore `ref`.
 *
 * @param {object} featureSet the document being edited
 * @param {{ key: string, feature: object }} found
 * @param {{ ref?: string }} normalizedEdits
 * @param {string} documentKey
 * @returns {boolean}
 */
function renamesOntoRefInUse(featureSet, found, normalizedEdits, documentKey) {
  return (
    documentKey === 'baseline' &&
    renameClashes(featureSet, {
      layer: found.key,
      current: found.feature.ref,
      next: normalizedEdits.ref,
      exceptFeatureId: found.feature.featureId
    })
  )
}

/**
 * Locate the feature an edit names and recompute its derived block, or say why
 * the edit cannot proceed. Every way an edit is turned away lives here, so the
 * apply path below deals only with edits that are going ahead.
 *
 * @param {object | undefined} featureSet the document being edited
 * @param {{ featureId: string, normalizedEdits: object, expectedType?: string, documentKey: string, logger: object, baseline?: object }} params
 *   `baseline` is the project's baseline document, which a post-intervention
 *   hedgerow edit takes its baseline lengths from
 * @returns {{ found: object, derived: object } | { rejection: object }}
 */
function resolveEditTarget(
  featureSet,
  { featureId, normalizedEdits, expectedType, documentKey, logger, baseline }
) {
  const found = findFeature(featureSet, featureId)
  if (!found) {
    return { rejection: { status: APPLY_RESULT.FEATURE_NOT_FOUND } }
  }
  if (expectedType && found.type !== expectedType) {
    return {
      rejection: { status: APPLY_RESULT.FEATURE_WRONG_TYPE, type: found.type }
    }
  }
  if (hasUnsupportedTimingEdit(found, normalizedEdits, documentKey)) {
    return {
      rejection: { status: APPLY_RESULT.UNSUPPORTED_TYPE, type: found.type }
    }
  }
  if (renamesOntoRefInUse(featureSet, found, normalizedEdits, documentKey)) {
    return {
      rejection: {
        status: APPLY_RESULT.REF_IN_USE,
        type: found.type,
        ref: normalizedEdits.ref
      }
    }
  }
  const derived = recomputeForType(found.type, found.feature, normalizedEdits, {
    documentKey,
    logger,
    baseline
  })
  if (!derived) {
    return {
      rejection: { status: APPLY_RESULT.UNSUPPORTED_TYPE, type: found.type }
    }
  }
  // The dropdowns never offer High/V.High, but a crafted or stale PUT can
  // still submit a habitat type whose true distinctiveness is out of scope.
  // Reject it here — the shared chokepoint for every edit route and both
  // documents — so an out-of-scope band can never be persisted, mirroring
  // the upload gate (distinctiveness-check.js).
  if (
    derived.distinctiveness &&
    OUT_OF_SCOPE_BANDS.has(derived.distinctiveness)
  ) {
    return {
      rejection: {
        status: APPLY_RESULT.OUT_OF_SCOPE,
        type: found.type,
        distinctiveness: derived.distinctiveness
      }
    }
  }
  const rule = brokenEnhancementRule(found, derived, documentKey)
  if (rule) {
    return {
      rejection: {
        status: APPLY_RESULT.INVALID_ENHANCEMENT,
        type: found.type,
        rule
      }
    }
  }
  return { found, derived }
}

/**
 * The edited document: the feature spliced into its layer, and, when the edit
 * moves a baseline tree to another setting, its habitat-size summary
 * refreshed. The stored document is not mutated.
 *
 * @param {object} featureSet the document being edited
 * @param {{ found: object, updatedFeature: object, featureId: string, documentKey: string }} edit
 * @returns {{ index: number, updatedFeatureSet: object, habitatSizes: object | undefined }}
 */
function withUpdatedFeature(
  featureSet,
  { found, updatedFeature, featureId, documentKey }
) {
  const index = featureSet[found.key].findIndex(
    (f) => f?.featureId === featureId
  )
  const updatedFeatureSet = spliceFeatureInFeatureSet(
    featureSet,
    found.key,
    index,
    updatedFeature
  )
  const habitatSizes = withEditedTreeSizes(
    updatedFeatureSet,
    found,
    updatedFeature,
    documentKey
  )
  if (habitatSizes) {
    updatedFeatureSet.habitatSizes = habitatSizes
  }
  return { index, updatedFeatureSet, habitatSizes }
}

/**
 * Given a project document, locate `featureId`, recompute its derived block
 * from the supplied edits, splice it back into its layer, and refresh the
 * feature-set unit totals. Returns the updated project plus the updated
 * feature; callers persist the project.
 *
 * A baseline edit additionally re-derives the whole post-intervention document
 * when the project has one, because that document holds its own copy of the
 * baseline and every figure it carries is measured against it — see
 * resync-post-intervention-baseline.js.
 *
 * `expectedType` lets the legacy typed PUT routes 404 cross-layer access
 * (e.g. hedgerow featureId posted to `/projects/{id}/habitats/{id}`). Omit
 * it on the unified route — the type is whatever the data says it is.
 *
 * @param {object} project — full row.project JSONB
 * @param {object} params
 * @param {string} params.featureId
 * @param {object} params.edits  { ref?, broadType?, habitatType?, condition?, comment? }
 *   `ref` renames a baseline feature (BMD-1061), or a Created area when
 *   the complete timing/strategic edit payload is supplied (BMD-1048). The re-derive then carries the new ref onto the
 *   post-intervention rows measured against the feature, so the two documents
 *   stay joined (resync-post-intervention-baseline.js).
 * @param {string} [params.expectedType]
 * @param {'baseline'|'postIntervention'} [params.documentKey]
 * @param {{ warn: Function }} [params.logger] warns about post-intervention
 *   rows the re-derive could not match to a baseline feature, and about a
 *   proposed strategic significance the recompute had to reject (BMD-1051)
 * @returns {
 *   { status: 'ok', type: string, project: object, feature: object, habitatSizes?: object, postIntervention: object | null } |
 *   { status: 'outOfScope', type: string, distinctiveness: string } |
 *   { status: 'invalidEnhancement', type: string, rule: string } |
 *   { status: 'refInUse', type: string, ref: string } |
 *   { status: 'featureNotFound' | 'featureWrongType' | 'unsupportedType', type?: string }
 * }
 */
function applyFeatureUpdate(
  project,
  {
    featureId,
    edits,
    expectedType,
    documentKey = 'baseline',
    logger = NO_OP_LOGGER
  }
) {
  const normalizedEdits = normalizeEdits(edits)
  const featureSet = project?.[documentKey]
  const target = resolveEditTarget(featureSet, {
    featureId,
    normalizedEdits,
    expectedType,
    documentKey,
    logger,
    baseline: project?.baseline
  })
  if (target.rejection) {
    return target.rejection
  }
  const { found, derived } = target
  const updatedFeature = resolveUpdatedFeature(
    found,
    normalizedEdits,
    derived,
    {
      documentKey,
      baseline: project?.baseline?.[found.key],
      serviceTemplate: isTemplateUpload(project?.postIntervention)
    }
  )
  const { index, updatedFeatureSet, habitatSizes } = withUpdatedFeature(
    featureSet,
    { found, updatedFeature, featureId, documentKey }
  )
  const postIntervention = refreshFiguresDownstreamOfEdit(updatedFeatureSet, {
    project,
    documentKey,
    previousFeatureSet: featureSet,
    editedType: found.type,
    logger
  })
  // `layer` / `index` / `unitsTotals` / `tradingRules` let callers persist
  // surgically via persist-project.js (jsonb_set the one feature + the derived
  // subtrees) rather than rewriting the whole document. `postIntervention` is
  // the one subtree that cannot be patched surgically — baseline and template
  // post-intervention watercourse edits can move sibling figures. `project` is
  // retained for callers/tests that want the fully-rebuilt document.
  return {
    status: APPLY_RESULT.OK,
    type: found.type,
    layer: found.key,
    index,
    feature: updatedFeatureSet[found.key][index],
    unitsTotals: updatedFeatureSet.units,
    tradingRules: updatedFeatureSet.tradingRules,
    // Refreshed by a post-intervention edit to a template upload; persisted
    // alongside the feature, since nothing else writes it (BMD-1083).
    lostHabitats:
      documentKey === 'postIntervention'
        ? updatedFeatureSet.lostHabitats
        : undefined,
    // Refreshed by a tree edit, whose setting the urban and rural sizes are
    // split by.
    habitatSizes,
    postIntervention,
    project: rebuiltProject(
      project,
      documentKey,
      updatedFeatureSet,
      postIntervention
    )
  }
}

export { applyFeatureUpdate, APPLY_RESULT }
