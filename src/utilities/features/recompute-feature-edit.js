// How an edit to one feature is priced, by layer and document (BMD-480 on).
// apply-feature-update.js merges the result into the project; this module
// only picks the recompute for the feature's type and returns what it derived,
// or null when that type is not editable there.

import {
  recomputeCreatedWatercourseEdit,
  recomputeEnhancedWatercourseEdit
} from '../../validation/geopackage/post-intervention/recompute-created-watercourse-edit.js'
import {
  recomputeCreatedHedgerowEdit,
  recomputeEnhancedHedgerowEdit
} from '../../validation/geopackage/post-intervention/recompute-created-hedgerow-edit.js'
import { recomputeCreatedAreaEdit } from '../../validation/geopackage/post-intervention/recompute-created-area-edit.js'
import {
  recomputeAreaHabitat,
  recomputeHedgerow,
  recomputeWatercourse
} from '../../validation/geopackage/unit-calculation.js'
import { recomputePostInterventionAreaHabitat } from '../../validation/geopackage/post-intervention/recompute-post-intervention-area-habitat.js'
import { recomputePostInterventionHedgerow } from '../../validation/geopackage/post-intervention/recompute-post-intervention-hedgerow.js'
import {
  RETENTION_ENHANCED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import { postInterventionEnrichOptions } from '../enrichment/post-intervention/post-intervention-enrich-options.js'
import {
  VERTICAL_BROAD_HABITATS,
  isVerticalHabitat
} from '../../validation/reference/vertical-habitats.js'
import { keepsTreeATree } from './tree-edit.js'

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
  { documentKey, logger, baseline, serviceTemplate }
) {
  if (documentKey === 'postIntervention') {
    if (Object.hasOwn(edits, 'advanceYears')) {
      return resolveRetentionCategory(existing) === RETENTION_ENHANCED
        ? recomputeEnhancedHedgerowEdit(existing, edits, {
            baselineLengthByRef:
              postInterventionEnrichOptions(baseline).baselineLengthByRef,
            baselineHedgerows: baseline?.hedgerows,
            serviceTemplate
          })
        : recomputeCreatedHedgerowEdit(existing, edits)
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

function recomputeWatercourseEdit(
  existing,
  edits,
  { documentKey, baseline, serviceTemplate }
) {
  if (documentKey === 'postIntervention') {
    if (!Object.hasOwn(edits, 'advanceYears')) {
      return null
    }
    // An Enhanced watercourse is priced against its baseline (BMD-1047).
    return resolveRetentionCategory(existing) === RETENTION_ENHANCED
      ? recomputeEnhancedWatercourseEdit(existing, edits, {
          baselineLengthByRef:
            postInterventionEnrichOptions(baseline).baselineLengthByRef,
          baselineWatercourses: baseline?.watercourses,
          serviceTemplate
        })
      : recomputeCreatedWatercourseEdit(existing, edits)
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
 * After intervention a Created or an Enhanced tree is edited this way, with
 * the Created area habitat edit's complete payload, and priced by its
 * retention category as the upload prices it: a Created tree as a creation,
 * and an Enhanced one as an enhancement of its baseline tree's condition, in
 * its baseline tree's setting (post-intervention-tree-edit.js). A Retained
 * tree's reference is renamed through apply-retained-ref-edit.js.
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

/**
 * Prices an edit to one feature as its layer and document price it.
 *
 * @param {string} type the feature's type, e.g. 'habitat' or 'hedgerow'
 * @param {object} existing the stored feature
 * @param {object} edits the normalised edit
 * @param {{ documentKey: string, logger?: object, baseline?: object, serviceTemplate?: boolean }} context
 * @returns {object | null} what the recompute derived, or null when the type
 *   cannot be edited in that document
 */
export function recomputeForType(type, existing, edits, context) {
  return Object.hasOwn(RECOMPUTE_EDIT_BY_TYPE, type)
    ? RECOMPUTE_EDIT_BY_TYPE[type](existing, edits, context)
    : null
}
