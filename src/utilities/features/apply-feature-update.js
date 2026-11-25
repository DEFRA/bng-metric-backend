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
//   - adding a new feature type later means adding one recompute function
//     (recompute-feature-edit.js), not a new persistence path.

import { OUT_OF_SCOPE_BANDS } from '../../validation/geopackage/distinctiveness-check.js'
import { brokenEditRule, EDIT_RULE_KIND } from './edit-rules.js'
import { normalizeEdits } from './normalize-edits.js'
import {
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import { isTemplateUpload } from '../enrichment/post-intervention/lineage-outcomes.js'
import {
  copyProposedDisplayFields,
  copyProposedEngineMetrics
} from '../enrichment/shared/proposed-enrichment-fields.js'

import { preserveCreatedParent } from '../enrichment/post-intervention/resync-post-intervention-baseline.js'
import { NO_OP_LOGGER } from '../enrichment/shared/enrich-units-shared.js'
import { baselineFeatureOrangeFlags } from '../enrichment/baseline/baseline-orange-flags.js'
import { postInterventionFeatureOrangeFlags } from '../enrichment/post-intervention/post-intervention-orange-flags.js'
import { refreshFiguresDownstreamOfEdit } from './refresh-edit-figures.js'
import { findFeature } from './find-feature.js'
import { renameClashes } from './ref-in-use.js'
import {
  allowsTreeSizeEdit,
  withEditedTreeSize,
  withEditedTreeSizes
} from './tree-edit.js'
import { recomputeForType } from './recompute-feature-edit.js'

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
  INVALID_DEGRADE: 'invalidDegrade',
  REF_IN_USE: 'refInUse'
})

/** The rejection for each kind of service rule an edit breaks. */
const REJECTION_BY_EDIT_RULE = Object.freeze({
  [EDIT_RULE_KIND.enhancement]: APPLY_RESULT.INVALID_ENHANCEMENT,
  [EDIT_RULE_KIND.degrade]: APPLY_RESULT.INVALID_DEGRADE
})

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

/**
 * A Created or Enhanced habitat's supporting information (BMD-1153,
 * BMD-1190), saved on the post-intervention row itself, not on its baseline
 * parcel. Every feature that takes the complete edit saves its comment with
 * it, so an Enhanced kind made editable later saves its comment too. An edit
 * that leaves the comment out keeps the stored one.
 *
 * @param {{ type: string, feature: object }} found the feature before the edit
 * @param {object} updated the recomputed feature
 * @param {{ comment?: string | null }} edits normalised edits
 * @returns {object}
 */
function withOwnComment(found, updated, edits) {
  if (edits.comment === undefined || !takesCompleteEdit(found)) {
    return updated
  }
  return { ...updated, comment: edits.comment }
}

/**
 * An edited feature's orange flags (BMD-822), derived again from the fields
 * the edit saved so they never describe the values it replaced.
 *
 * @param {object} feature the recomputed feature
 * @param {string} layerKey
 * @param {string} documentKey
 * @returns {object}
 */
function withOrangeFlags(feature, layerKey, documentKey) {
  const deriveFlags =
    documentKey === 'postIntervention'
      ? postInterventionFeatureOrangeFlags
      : baselineFeatureOrangeFlags
  return { ...feature, orangeFlags: deriveFlags(feature, layerKey) }
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
    ? withOwnComment(found, derived.updatedFeature, edits)
    : mergeFeature(
        found.type,
        withEditedTreeSize(found.feature, edits, documentKey),
        edits,
        derived,
        documentKey
      )
  preserveCreatedParent(found.feature, updated, {
    documentKey,
    layer: found.key,
    baseline,
    serviceTemplate
  })
  return withOrangeFlags(
    withoutImportedRejection(updated, documentKey),
    found.key,
    documentKey
  )
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
const ENHANCED_EDIT_TYPES = new Set([
  'habitat',
  'tree',
  'hedgerow',
  'watercourse'
])

/**
 * Whether the complete edit payload may be applied to a feature of this
 * retention: a Created one of any type that takes it, an Enhanced tree,
 * whose condition is all it enhances, and an Enhanced area habitat,
 * hedgerow or watercourse, edited within its baseline's valid enhancements
 * (BMD-1045, BMD-1046, BMD-1047).
 *
 * @param {{ type: string, feature: object }} found
 * @returns {boolean}
 */
function takesCompleteEdit(found) {
  const retention = resolveRetentionCategory(found.feature)
  return (
    retention === RETENTION_CREATED ||
    (ENHANCED_EDIT_TYPES.has(found.type) && retention === RETENTION_ENHANCED)
  )
}

function hasUnsupportedTimingEdit(found, edits, documentKey) {
  const unsupportedLinearBroadType =
    !BROAD_HABITAT_TYPES.has(found.type) && edits.broadType !== null
  return (
    documentKey === 'postIntervention' &&
    Object.hasOwn(edits, 'advanceYears') &&
    (!CREATED_EDIT_TYPES.has(found.type) ||
      unsupportedLinearBroadType ||
      !takesCompleteEdit(found) ||
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
    !isTemplateUpload(featureSet) &&
    renameClashes(featureSet, {
      layer: found.key,
      current: found.feature.ref,
      next: normalizedEdits.ref,
      exceptFeatureId: found.feature.featureId
    })
  )
}

/**
 * Why an edit to a feature that was found is turned away before it is
 * priced, or null when it can be priced: a timing edit its feature does not
 * take, a size class its feature cannot change to, or, on a legacy upload, a
 * rename onto a reference in use.
 *
 * @param {object} featureSet the document being edited
 * @param {{ type: string, key: string, feature: object }} found
 * @param {object} normalizedEdits
 * @param {{ documentKey: string, serviceTemplate: boolean }} context
 * @returns {object | null} the rejection
 */
function refusedBeforePricing(featureSet, found, normalizedEdits, context) {
  const { documentKey } = context
  if (
    hasUnsupportedTimingEdit(found, normalizedEdits, documentKey) ||
    !allowsTreeSizeEdit(found, normalizedEdits, context)
  ) {
    return { status: APPLY_RESULT.UNSUPPORTED_TYPE, type: found.type }
  }
  if (renamesOntoRefInUse(featureSet, found, normalizedEdits, documentKey)) {
    return {
      status: APPLY_RESULT.REF_IN_USE,
      type: found.type,
      ref: normalizedEdits.ref
    }
  }
  return null
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
  const serviceTemplate = isTemplateUpload(featureSet)
  const refused = refusedBeforePricing(featureSet, found, normalizedEdits, {
    documentKey,
    serviceTemplate
  })
  if (refused) {
    return { rejection: refused }
  }
  const derived = recomputeForType(found.type, found.feature, normalizedEdits, {
    documentKey,
    logger,
    baseline,
    serviceTemplate
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
  const broken = brokenEditRule(found, derived, {
    documentKey,
    baseline,
    serviceTemplate: isTemplateUpload(featureSet)
  })
  if (broken) {
    return {
      rejection: {
        status: REJECTION_BY_EDIT_RULE[broken.kind],
        type: found.type,
        rule: broken.rule
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
 * @param {object} params.edits  { ref?, broadType?, habitatType?, condition?, comment?, treeSize? }
 *   `treeSize` moves a BNG Service template tree to another size class: a
 *   baseline tree, whose Retained or Enhanced tree takes it on the re-derive,
 *   or a Created tree. Any other feature asking for one is unsupportedType.
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
 *   { status: 'invalidDegrade', type: string, rule: string } |
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
