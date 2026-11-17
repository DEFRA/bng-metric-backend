import { withRootRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { proposedAttributes } from './created-feature-edit.js'
import { recomputePostInterventionHedgerow } from './recompute-post-intervention-hedgerow.js'
import { clearEngineDerivedProposedFields } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'
import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'
import { renamedParentFeatureId } from '../../../utilities/enrichment/post-intervention/resync-post-intervention-baseline.js'

// Use the same guards, null-unit convention and result mapping as import/resync.
// The edit form derives partial display values without persisting a second shape.
export function recomputeCreatedHedgerowEdit(existing, edits) {
  const feature = withRootRetentionCategory(structuredClone(existing))
  feature.ref = edits.ref.trim()
  feature.proposed = proposedAttributes(feature.proposed, edits)
  clearEngineDerivedProposedFields(feature)
  return recomputePostInterventionHedgerow(feature, edits)
}

/**
 * Recompute an Enhanced hedgerow's complete edit (BMD-1046), priced against
 * its baseline hedgerow's length. It is priced under the ref it had before
 * the edit, as a legacy row with no parent finds its baseline length by ref.
 * A rename is priced against the parent it records (preserveCreatedParent),
 * found the same way, so a ref several baseline hedgerows share prices and
 * links it to the same one. An edit that leaves an attribute the calculation
 * needs blank saves zero units, as BMD-1046 AC10 Scenario B asks.
 *
 * @param {object} existing the stored Enhanced hedgerow
 * @param {object} edits the validated edit
 * @param {{ baselineLengthByRef: Map<string, number>, baselineHedgerows?: object[], serviceTemplate?: boolean }} options
 * @returns {object} as recomputePostInterventionHedgerow returns
 */
export function recomputeEnhancedHedgerowEdit(
  existing,
  edits,
  { baselineLengthByRef, baselineHedgerows, serviceTemplate = false }
) {
  const feature = withRootRetentionCategory(structuredClone(existing))
  if (
    !serviceTemplate &&
    edits.ref.trim() !== existing.ref &&
    !Object.hasOwn(existing, 'parentFeatureId')
  ) {
    feature.parentFeatureId = renamedParentFeatureId(existing, {
      layer: 'hedgerows',
      baseline: baselineHedgerows
    })
  }
  feature.proposed = proposedAttributes(feature.proposed, edits)
  clearEngineDerivedProposedFields(feature)
  const result = recomputePostInterventionHedgerow(feature, edits, {
    baselineLengthByRef
  })
  result.updatedFeature.ref = edits.ref.trim()
  if (result.status === HABITAT_STATUS.INCOMPLETE) {
    result.units = 0
    result.updatedFeature.units = 0
  }
  return result
}
