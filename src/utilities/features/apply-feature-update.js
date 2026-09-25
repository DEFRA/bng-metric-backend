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

import {
  recomputeAreaHabitat,
  recomputeHedgerow,
  recomputeWatercourse
} from '../../validation/geopackage/unit-calculation.js'
import { OUT_OF_SCOPE_BANDS } from '../../validation/geopackage/distinctiveness-check.js'
import { recomputePostInterventionAreaHabitat } from '../../validation/geopackage/post-intervention/recompute-post-intervention-area-habitat.js'
import {
  copyProposedDisplayFields,
  copyProposedEngineMetrics
} from '../enrichment/shared/proposed-enrichment-fields.js'

import { enrichPostInterventionAreaTradingRules } from '../enrichment/post-intervention/enrich-post-intervention-area-trading-rules.js'
import { enrichPostInterventionWatercourseTradingRules } from '../enrichment/post-intervention/enrich-post-intervention-watercourse-trading-rules.js'
import { rederivePostInterventionFromBaseline } from '../enrichment/post-intervention/resync-post-intervention-baseline.js'
import { NO_OP_LOGGER } from '../enrichment/shared/enrich-units-shared.js'
import {
  addPostInterventionNetUnitChanges,
  summarizeFeatureSetUnitsTotals
} from './feature-set-units.js'
import { findFeature } from './find-feature.js'

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
  OUT_OF_SCOPE: 'outOfScope'
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

function normalizeEdits(edits = {}) {
  return {
    broadType: blankToNull(edits.broadType),
    habitatType: blankToNull(edits.habitatType),
    condition: blankToNull(edits.condition),
    watercourseEncroachment: blankToNull(edits.watercourseEncroachment),
    riparianEncroachment: blankToNull(edits.riparianEncroachment)
  }
}

function recomputeForType(type, existing, edits, documentKey) {
  if (type === 'habitat') {
    if (documentKey === 'postIntervention') {
      return recomputePostInterventionAreaHabitat(existing, {
        broadType: edits.broadType,
        habitatType: edits.habitatType,
        condition: edits.condition
      })
    }
    return recomputeAreaHabitat({
      broadType: edits.broadType,
      habitatType: edits.habitatType,
      condition: edits.condition,
      sizeSquareMetres: existing.sizeSquareMetres ?? existing.area ?? null
    })
  } else if (type === 'hedgerow') {
    return recomputeHedgerow({
      habitatType: edits.habitatType,
      condition: edits.condition,
      sizeMetres: existing.sizeMetres ?? null
    })
  } else if (type === 'watercourse') {
    // Post-intervention watercourse editing is out of scope; only the baseline
    // document recomputes a watercourse here (BMD-597).
    if (documentKey === 'postIntervention') {
      return null
    }
    return recomputeWatercourse({
      habitatType: edits.habitatType,
      condition: edits.condition,
      watercourseEncroachment: edits.watercourseEncroachment,
      riparianEncroachment: edits.riparianEncroachment,
      sizeMetres: existing.sizeMetres ?? null
    })
  } else {
    return null
  }
}

function mergeBaselineFeature(type, existing, edits, derived) {
  const base = {
    ...existing,
    condition: edits.condition,
    distinctiveness: derived.distinctiveness,
    distinctivenessScore: derived.distinctivenessScore,
    conditionScore: derived.conditionScore,
    units: derived.units,
    status: derived.status
  }
  if (type === 'habitat') {
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

function resolveUpdatedFeature(found, edits, derived, documentKey) {
  const recomputedWholeFeature =
    documentKey === 'postIntervention' &&
    found.type === 'habitat' &&
    derived.updatedFeature
  if (recomputedWholeFeature) {
    return derived.updatedFeature
  }
  return mergeFeature(found.type, found.feature, edits, derived, documentKey)
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
 * Refresh every figure that stood on the feature just edited: the document's own
 * unit totals, and then whatever measured against it.
 *
 * The two documents measure against each other, so which one was edited decides
 * what else has to move. A post-intervention edit refreshes that document's own
 * net unit changes and trading-rules figures — an edit moves units between
 * habitat types, so those are stale until recomputed from the updated feature
 * set. A baseline edit instead changes what the post-intervention document was
 * measured against, so that whole document is re-derived rather than left
 * quoting the old baseline.
 *
 * The re-derive needs the baseline on both sides of the edit: the edited
 * document to take values from, and `previousFeatureSet` — the pre-edit one —
 * to tell which of several features sharing a ref each post-intervention row
 * describes.
 *
 * @param {object} updatedFeatureSet the edited document, mutated
 * @param {{ project: object, documentKey: string, previousFeatureSet: object, logger: object }} context
 * @returns {object | null} the re-derived post-intervention document, or null
 *   when the edit was to that document or the project has none
 */
function refreshFiguresDownstreamOfEdit(
  updatedFeatureSet,
  { project, documentKey, previousFeatureSet, logger }
) {
  summarizeFeatureSetUnitsTotals(updatedFeatureSet)
  if (documentKey === 'postIntervention') {
    addPostInterventionNetUnitChanges(
      updatedFeatureSet,
      project?.baseline?.units
    )
    enrichPostInterventionAreaTradingRules(
      updatedFeatureSet,
      project?.baseline,
      logger
    )
    enrichPostInterventionWatercourseTradingRules(
      updatedFeatureSet,
      project?.baseline?.watercourses ?? [],
      logger
    )
    return null
  }
  return rederivePostInterventionFromBaseline(
    project?.postIntervention,
    { baseline: updatedFeatureSet, previousBaseline: previousFeatureSet },
    logger
  )
}

/**
 * Locate the feature an edit names and recompute its derived block, or say why
 * the edit cannot proceed. Every way an edit is turned away lives here, so the
 * apply path below deals only with edits that are going ahead.
 *
 * @param {object | undefined} featureSet the document being edited
 * @param {{ featureId: string, normalizedEdits: object, expectedType?: string, documentKey: string }} params
 * @returns {{ found: object, derived: object } | { rejection: object }}
 */
function resolveEditTarget(
  featureSet,
  { featureId, normalizedEdits, expectedType, documentKey }
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
  const derived = recomputeForType(
    found.type,
    found.feature,
    normalizedEdits,
    documentKey
  )
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
  return { found, derived }
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
 * @param {object} params.edits  { broadType?, habitatType?, condition? }
 * @param {string} [params.expectedType]
 * @param {'baseline'|'postIntervention'} [params.documentKey]
 * @param {{ warn: (msg: string) => void }} [params.logger] warns about
 *   post-intervention rows the re-derive could not match to a baseline feature
 * @returns {
 *   { status: 'ok', type: string, project: object, feature: object, postIntervention: object | null } |
 *   { status: 'outOfScope', type: string, distinctiveness: string } |
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
    documentKey
  })
  if (target.rejection) {
    return target.rejection
  }
  const { found, derived } = target
  const updatedFeature = resolveUpdatedFeature(
    found,
    normalizedEdits,
    derived,
    documentKey
  )
  const index = featureSet[found.key].findIndex(
    (f) => f?.featureId === featureId
  )
  const updatedFeatureSet = spliceFeatureInFeatureSet(
    featureSet,
    found.key,
    index,
    updatedFeature
  )
  const postIntervention = refreshFiguresDownstreamOfEdit(updatedFeatureSet, {
    project,
    documentKey,
    previousFeatureSet: featureSet,
    logger
  })
  // `layer` / `index` / `unitsTotals` / `tradingRules` let callers persist
  // surgically via persist-project.js (jsonb_set the one feature + the derived
  // subtrees) rather than rewriting the whole document. `postIntervention` is
  // the one subtree that cannot be patched surgically — a baseline edit can
  // move any number of its figures — so it is handed over whole. `project` is
  // retained for callers/tests that want the fully-rebuilt document.
  return {
    status: APPLY_RESULT.OK,
    type: found.type,
    layer: found.key,
    index,
    feature: updatedFeature,
    unitsTotals: updatedFeatureSet.units,
    tradingRules: updatedFeatureSet.tradingRules,
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
