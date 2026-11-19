import { withRootRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { proposedAttributes } from './created-feature-edit.js'
import { enrichPostInterventionWatercourseWithUnits } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-watercourse.js'
import { clearEngineDerivedProposedFields } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'
import { renamedParentFeatureId } from '../../../utilities/enrichment/post-intervention/resync-post-intervention-baseline.js'

export function recomputeCreatedWatercourseEdit(existing, edits) {
  const feature = withRootRetentionCategory(structuredClone(existing))
  feature.ref = edits.ref.trim()
  feature.proposed = {
    ...proposedAttributes(feature.proposed, edits),
    watercourseEncroachment: edits.watercourseEncroachment,
    riparianEncroachment: edits.riparianEncroachment,
    waterEncroachmentMultiplier: null,
    riparianEncroachmentMultiplier: null
  }
  feature.editedAdvanceYears = feature.proposed.advanceYears
  clearEngineDerivedProposedFields(feature)
  enrichPostInterventionWatercourseWithUnits(feature, NO_OP_LOGGER)
  // BMD-1050 AC11 Scenario B, as BMD-1048 does for a Created area: saving the
  // form with an attribute the calculation needs left blank saves zero units.
  // Imports and recalculations keep BMD-1070's null units.
  if (feature.status === HABITAT_STATUS.INCOMPLETE) {
    feature.units = 0
  }
  return {
    updatedFeature: feature,
    units: feature.units,
    status: feature.status,
    distinctiveness: feature.proposed.distinctiveness
  }
}

/**
 * Recompute an Enhanced watercourse's complete edit (BMD-1047), priced against
 * its baseline watercourse's length, as an Enhanced hedgerow's is
 * (recomputeEnhancedHedgerowEdit): under the ref it had before the edit, and
 * a rename against the parent it then records, or, for a BNG Service template
 * row that names no parent, by its new ref. An edit that leaves an attribute
 * the calculation needs blank, its encroachments included, saves zero units,
 * as BMD-1047 AC12 Scenario B asks.
 *
 * @param {object} existing the stored Enhanced watercourse
 * @param {object} edits the validated edit
 * @param {{ baselineLengthByRef: Map<string, number>, baselineWatercourses?: object[], serviceTemplate?: boolean }} options
 * @returns {object} as recomputeCreatedWatercourseEdit returns
 */
export function recomputeEnhancedWatercourseEdit(
  existing,
  edits,
  { baselineLengthByRef, baselineWatercourses, serviceTemplate = false }
) {
  const feature = withRootRetentionCategory(structuredClone(existing))
  const ref = edits.ref.trim()
  if (ref !== existing.ref && !Object.hasOwn(existing, 'parentFeatureId')) {
    if (serviceTemplate) {
      feature.ref = ref
    } else {
      feature.parentFeatureId = renamedParentFeatureId(existing, {
        layer: 'watercourses',
        baseline: baselineWatercourses
      })
    }
  }
  feature.proposed = {
    ...proposedAttributes(feature.proposed, edits),
    watercourseEncroachment: edits.watercourseEncroachment,
    riparianEncroachment: edits.riparianEncroachment,
    waterEncroachmentMultiplier: null,
    riparianEncroachmentMultiplier: null
  }
  clearEngineDerivedProposedFields(feature)
  enrichPostInterventionWatercourseWithUnits(
    feature,
    NO_OP_LOGGER,
    baselineLengthByRef
  )
  feature.ref = ref
  if (feature.status === HABITAT_STATUS.INCOMPLETE) {
    feature.units = 0
  }
  return {
    updatedFeature: feature,
    units: feature.units,
    status: feature.status,
    distinctiveness: feature.proposed.distinctiveness
  }
}
