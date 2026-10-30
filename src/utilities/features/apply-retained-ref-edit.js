// Rename a Retained post-intervention habitat (BMD-1180). Pure — does no I/O.
// The route wraps the result in its transaction and writes it back.
//
// A Retained row is its baseline parcel carried forward unchanged, and on the
// legacy template the ref is the only thing joining the two documents: the
// re-derive after a baseline edit, the linear baseline lengths, feature-ID
// carry-forward on re-upload and the frontend's "View baseline details" link
// all find a row's baseline parcel by its ref. Renaming the row alone would cut
// it loose from that parcel.
//
// So the rename is made to the baseline parcel the row is joined to, and the
// re-derive carries it onto every post-intervention row joined to that parcel
// — the edited row and any others that split from it — exactly as a baseline
// rename does (BMD-1061). The two documents stay joined however the rename
// was started.
//
// Two cases rename the row alone:
//
//   - A BNG Service template upload's row (BMD-1083). Its parent is named by
//     `parentFeatureId`, and the re-derive finds it by that and leaves the
//     row's ref alone (BMD-1086): refs are labels there, not the join, so the
//     baseline keeps its own. A legacy row carrying a parent is treated the
//     same way.
//   - A row whose baseline parcel cannot be told: no baseline feature carries
//     its ref, or several share it and its imported values do not pick one
//     out (resync-post-intervention-baseline.js). Renaming a guessed parcel
//     would move a different habitat, so only the row moves, and that is
//     logged. Renaming it onto a parcel's ref joins it to that parcel, which
//     is how a row imported with a mistyped ref is repaired.
//
// Only a rename through the baseline changes a baseline ref, so only that one
// is refused when another baseline habitat already carries the new ref, as a
// baseline rename is (ref-in-use.js). A row renamed alone creates no clash
// between baseline habitats.

import { cleanHabitatRef } from '../../validation/geopackage/habitat-ref-check.js'
import { isTemplateUpload } from '../enrichment/post-intervention/lineage-outcomes.js'
import {
  RETENTION_RETAINED,
  resolveRetentionCategory,
  withRootRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import {
  UNRESOLVED_REASONS,
  rederivePostInterventionFromBaseline,
  resolveJoinedBaselineFeature
} from '../enrichment/post-intervention/resync-post-intervention-baseline.js'
import { NO_OP_LOGGER } from '../enrichment/shared/enrich-units-shared.js'
import {
  addPostInterventionNetUnitChanges,
  summarizeFeatureSetUnitsTotals
} from './feature-set-units.js'
import { findFeature } from './find-feature.js'
import { renameClashes } from './ref-in-use.js'

const LOG_PREFIX = 'applyRetainedRefEdit: '

const RETAINED_REF_RESULT = Object.freeze({
  OK: 'ok',
  FEATURE_NOT_FOUND: 'featureNotFound',
  NOT_RETAINED: 'notRetained',
  REF_IN_USE: 'refInUse'
})

/** The layers whose Retained rows have an editable reference (BMD-1180). */
const EDITABLE_LAYERS = new Set(['habitats', 'hedgerows', 'watercourses'])

function replaceAt(features, index, feature) {
  const updated = features.slice()
  updated[index] = feature
  return updated
}

/**
 * The baseline parcel a rename should be made to, or null when the row is to be
 * renamed alone (see the header).
 *
 * @param {{ key: string, feature: object }} found the post-intervention row
 * @param {object} project
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {object | null}
 */
function baselineParcelToRename(found, project, logger) {
  if (
    isTemplateUpload(project.postIntervention) ||
    found.feature.parentFeatureId
  ) {
    return null
  }
  const resolved = resolveJoinedBaselineFeature(
    found.feature,
    found.key,
    project.baseline
  )
  if (resolved.source) {
    return resolved.source
  }
  logger.warn(
    `${LOG_PREFIX}${found.key} featureId ${found.feature.featureId}: ${UNRESOLVED_REASONS[resolved.unresolvable](resolved.ref, resolved.candidateCount)}, so only this post-intervention row is renamed`
  )
  return null
}

function renameThroughBaseline(project, found, parcel, ref, logger) {
  const { baseline, postIntervention } = project
  const layer = found.key
  const index = baseline[layer].findIndex(
    (feature) => feature?.featureId === parcel.featureId
  )
  const feature = { ...parcel, ref }
  const updatedBaseline = {
    ...baseline,
    [layer]: replaceAt(baseline[layer], index, feature)
  }
  summarizeFeatureSetUnitsTotals(updatedBaseline)
  const rederived = rederivePostInterventionFromBaseline(
    postIntervention,
    { baseline: updatedBaseline, previousBaseline: baseline },
    logger
  )
  return {
    status: RETAINED_REF_RESULT.OK,
    type: found.type,
    documentKey: 'baseline',
    layer,
    index,
    feature,
    unitsTotals: updatedBaseline.units,
    postIntervention: rederived,
    postInterventionFeature: rederived[layer].find(
      (row) => row?.featureId === found.feature.featureId
    )
  }
}

/**
 * Rename the row alone. Its unit totals are recomputed rather than handed
 * back as stored, as a post-intervention edit refreshes them: a document saved
 * before the tree totals existed would not pass the write's schema check.
 */
function renameRowOnly(project, found, ref) {
  const { postIntervention } = project
  const layer = found.key
  const index = postIntervention[layer].findIndex(
    (feature) => feature?.featureId === found.feature.featureId
  )
  const feature = withRootRetentionCategory({ ...found.feature, ref })
  const updated = {
    ...postIntervention,
    [layer]: replaceAt(postIntervention[layer], index, feature)
  }
  summarizeFeatureSetUnitsTotals(updated)
  addPostInterventionNetUnitChanges(updated, project.baseline?.units)
  return {
    status: RETAINED_REF_RESULT.OK,
    type: found.type,
    documentKey: 'postIntervention',
    layer,
    index,
    feature,
    unitsTotals: updated.units,
    postIntervention: null,
    postInterventionFeature: feature
  }
}

/**
 * Rename the Retained post-intervention habitat `featureId`.
 *
 * The result says which document's feature to write (`documentKey`, `layer`,
 * `index`, `feature`, `unitsTotals`), plus the whole re-derived
 * post-intervention document when the rename went through the baseline — the
 * same pieces a baseline edit hands to setProjectFeature.
 * `postInterventionFeature` is the edited row as it now stands, for the
 * response.
 *
 * @param {object} project full row.project JSONB
 * @param {{ featureId: string, ref: string, logger?: { warn: (msg: string) => void } }} params
 *   `ref` has already been checked by the route: not blank, valid UTF-8. It is
 *   stored trimmed and cut to the length limit, as an import stores it
 *   (BMD-1058).
 * @returns {
 *   { status: 'ok', type: string, documentKey: 'baseline' | 'postIntervention', layer: string, index: number, feature: object, unitsTotals: object, postIntervention: object | null, postInterventionFeature: object } |
 *   { status: 'featureNotFound' } |
 *   { status: 'notRetained', type: string } |
 *   { status: 'refInUse', type: string, ref: string }
 * }
 */
function applyRetainedRefEdit(
  project,
  { featureId, ref, logger = NO_OP_LOGGER }
) {
  const found = findFeature(project?.postIntervention, featureId)
  if (!found) {
    return { status: RETAINED_REF_RESULT.FEATURE_NOT_FOUND }
  }
  if (
    !EDITABLE_LAYERS.has(found.key) ||
    resolveRetentionCategory(found.feature) !== RETENTION_RETAINED
  ) {
    return { status: RETAINED_REF_RESULT.NOT_RETAINED, type: found.type }
  }
  const cleaned = cleanHabitatRef(ref)
  const parcel = baselineParcelToRename(found, project, logger)
  if (!parcel) {
    return renameRowOnly(project, found, cleaned)
  }
  // The parcel may carry the reference itself; any other baseline habitat
  // carrying it would be merged with it.
  if (
    renameClashes(project.baseline, {
      layer: found.key,
      current: parcel.ref,
      next: cleaned,
      exceptFeatureId: parcel.featureId
    })
  ) {
    return {
      status: RETAINED_REF_RESULT.REF_IN_USE,
      type: found.type,
      ref: cleaned
    }
  }
  return renameThroughBaseline(project, found, parcel, cleaned, logger)
}

export { applyRetainedRefEdit, RETAINED_REF_RESULT }
