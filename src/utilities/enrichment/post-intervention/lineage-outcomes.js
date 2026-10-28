import {
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'
import {
  LENGTH_TOLERANCE_METRES,
  createdInOwnTypeMetres,
  isSameHabitatType,
  watercourseChange
} from '../../../validation/geopackage/service-template/lineage/habitat-change.js'
import { MIN_PARCEL_AREA_SQ_M } from '../../../validation/geopackage/geometry-constants.js'

/**
 * What a BNG Service template upload's post-intervention habitats do to their
 * baseline parents, worked out on the saved documents once each feature has
 * its parent's `featureId` (service-template/lineage/link-parents.js) and before it is priced
 * (BMD-1083). The file's checks (service-template/lineage/lineage-rules.js) have already refused one
 * that breaks the Metric's lineage rules. They are worked out again when an
 * edit changes what they depend on: a baseline edit re-derives the
 * post-intervention document (resync-post-intervention-baseline.js), and a
 * post-intervention edit, which can change a habitat's type but not a
 * watercourse, refreshes `lostHabitats` (apply-feature-update.js).
 *
 * - Only a Retained or Enhanced child carries its parent forward, so a parent
 *   is lost by its size less theirs. A Created child, linked or not, is a
 *   creation at its own size and condition: its copied Baseline Length is not
 *   retained length.
 * - A degraded row (a Created row of its parent's own habitat type) means its
 *   parent is lost and re-created, not removed (guide, "Habitat retention").
 * - A watercourse created 10 or more years in advance is what the guide
 *   allows only for an encroachment-only change. On any other Created
 *   watercourse linked to a parent the advance is set to null, so the row is
 *   saved Incomplete for the user to correct. Its length is that of the
 *   parent's same-type Created children together, as the file's check
 *   measures it, so a watercourse drawn in pieces is not shorter for that
 *   alone.
 */

/** The layers whose parents are tracked, with the size each is measured by. */
const LAYERS = Object.freeze({
  habitats: 'sizeSquareMetres',
  hedgerows: 'sizeMetres',
  watercourses: 'sizeMetres'
})

/**
 * Below this an area's loss is a sliver, not a habitat lost: the area the
 * service refuses as too small to be a parcel at all, a digitising artefact
 * rather than a habitat anyone intended to record. Retained and Enhanced
 * children drawn by hand rather than cut from their parent fall short of it
 * by slivers like this.
 */
const AREA_TOLERANCE_SQUARE_METRES = MIN_PARCEL_AREA_SQ_M

const TOLERANCE = Object.freeze({
  sizeSquareMetres: AREA_TOLERANCE_SQUARE_METRES,
  sizeMetres: LENGTH_TOLERANCE_METRES
})

/** The advance, in years, that the guide allows only for more encroachment. */
export const ENCROACHMENT_ONLY_ADVANCE_YEARS = 10

export const LOST_OUTCOME = Object.freeze({
  /** No post-intervention habitat names the parent. */
  removed: 'removed',
  /** A Created child of the parent's own type: it is lost and re-created. */
  lostAndRecreated: 'lostAndRecreated',
  /** Lost, in full or in part, to creations of another type or to nothing. */
  lost: 'lost'
})

const CONTINUING = new Set([RETENTION_RETAINED, RETENTION_ENHANCED])

const sizeOf = (feature, field) =>
  Number.isFinite(feature?.[field]) ? feature[field] : 0

/** Each layer's post-intervention features, by the parent they are linked to. */
function childrenByParent(features) {
  const children = new Map()
  for (const feature of features ?? []) {
    if (feature.parentFeatureId) {
      children.set(feature.parentFeatureId, [
        ...(children.get(feature.parentFeatureId) ?? []),
        feature
      ])
    }
  }
  return children
}

const isDegraded = (parent, child) =>
  resolveRetentionCategory(child) === RETENTION_CREATED &&
  isSameHabitatType(parent, child.proposed ?? {})

/** A parent's loss, or null when its Retained and Enhanced children keep it. */
function lostParent(layer, parent, children, sizeField) {
  const continuing = children.filter((child) =>
    CONTINUING.has(resolveRetentionCategory(child))
  )
  const kept = continuing.reduce(
    (sum, child) => sum + sizeOf(child, sizeField),
    0
  )
  const lostSize = Math.max(0, sizeOf(parent, sizeField) - kept)
  const recreated = children.filter((child) => isDegraded(parent, child))
  if (children.length > 0 && lostSize <= TOLERANCE[sizeField]) {
    return null
  }
  let outcome = LOST_OUTCOME.lost
  if (children.length === 0) {
    outcome = LOST_OUTCOME.removed
  } else if (recreated.length > 0) {
    outcome = LOST_OUTCOME.lostAndRecreated
  }
  return {
    layer,
    featureId: parent.featureId,
    ref: parent.ref ?? null,
    type: parent.type ?? null,
    outcome,
    [sizeField === 'sizeMetres' ? 'lostSizeMetres' : 'lostSizeSquareMetres']:
      lostSize,
    recreatedAs: recreated.map((child) => child.featureId)
  }
}

/**
 * The baseline habitats a template upload loses, in full or in part, each
 * with how it is lost. Hedgerows and watercourses give their lost length in
 * metres, area habitats their lost area in square metres. Trees are not
 * linked yet (BMD-1172).
 *
 * @param {object} postIntervention the post-intervention document, linked
 * @param {object} baseline the baseline document saved with it
 * @returns {Array<object>}
 */
export function lostBaselineHabitats(postIntervention, baseline) {
  const lost = []
  for (const [layer, sizeField] of Object.entries(LAYERS)) {
    const children = childrenByParent(postIntervention[layer])
    for (const parent of baseline?.[layer] ?? []) {
      const entry = lostParent(
        layer,
        parent,
        children.get(parent.featureId) ?? [],
        sizeField
      )
      if (entry) {
        lost.push(entry)
      }
    }
  }
  return lost
}

/**
 * Null the advance of each Created watercourse linked to a parent that is
 * created 10 or more years in advance without being an encroachment-only
 * change, so it is saved Incomplete. Returns the features changed.
 *
 * Only a linked creation, by design. A Created watercourse linked to a parent
 * is an intervention on that watercourse, recorded as its loss and a
 * creation, and the guide allows 10 or more years in advance there only "if
 * there are increases in encroachment with no other impacts" (watercourse
 * interventions). A change of River Type is another impact, so a linked
 * creation of another type loses its advance too. An unlinked creation, a
 * new length with no associated loss, is no intervention on a baseline
 * watercourse, so this rule does not reach it.
 *
 * @param {object} postIntervention the post-intervention document, linked
 * @param {object} baseline the baseline document saved with it
 * @returns {object[]}
 */
export function nullDisallowedWatercourseAdvance(postIntervention, baseline) {
  const parents = new Map(
    (baseline?.watercourses ?? []).map((parent) => [parent.featureId, parent])
  )
  const created = (postIntervention.watercourses ?? []).filter(
    (feature) =>
      parents.has(feature.parentFeatureId) &&
      resolveRetentionCategory(feature) === RETENTION_CREATED
  )
  const createdByParent = Map.groupBy(
    created,
    (feature) => feature.parentFeatureId
  )
  const changed = []
  for (const feature of created) {
    const advance = feature.proposed?.advanceYears
    if (!(advance >= ENCROACHMENT_ONLY_ADVANCE_YEARS)) {
      continue
    }
    const parent = parents.get(feature.parentFeatureId)
    const siblings = createdByParent.get(parent.featureId).map((sibling) => ({
      side: sibling.proposed,
      lengthMetres: sibling.sizeMetres
    }))
    const change = watercourseChange(
      { side: parent, lengthMetres: parent.sizeMetres },
      {
        side: feature.proposed,
        lengthMetres: createdInOwnTypeMetres(parent, siblings)
      }
    )
    if (!change.encroachmentOnly) {
      feature.proposed.advanceYears = null
      changed.push(feature)
    }
  }
  return changed
}

/**
 * Whether a post-intervention document carries lineage outcomes: it came
 * from a BNG Service template upload, which records `lostHabitats` (empty
 * when nothing is lost). A legacy upload names no parents, so has none.
 *
 * @param {object} postIntervention
 * @returns {boolean}
 */
export const hasLineageOutcomes = (postIntervention) =>
  Array.isArray(postIntervention?.lostHabitats)

/**
 * Apply both to a template upload's post-intervention document: null the
 * advance the guide does not allow, and record what each baseline parent
 * loses as `lostHabitats`.
 *
 * @param {object} postIntervention
 * @param {object} baseline
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {object} `postIntervention`
 */
export function applyLineageOutcomes(postIntervention, baseline, logger) {
  for (const feature of nullDisallowedWatercourseAdvance(
    postIntervention,
    baseline
  )) {
    logger.warn(
      `applyLineageOutcomes: watercourse featureId ${feature.featureId} is created 10 or more years in advance without being an encroachment-only change — advance nulled, saved Incomplete`
    )
  }
  postIntervention.lostHabitats = lostBaselineHabitats(
    postIntervention,
    baseline
  )
  return postIntervention
}
