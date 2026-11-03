import { withRootRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { proposedAttributes } from './created-feature-edit.js'
import { recomputePostInterventionHedgerow } from './recompute-post-intervention-hedgerow.js'
import { clearEngineDerivedProposedFields } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'

// Use the same guards, null-unit convention and result mapping as import/resync.
// The edit form derives partial display values without persisting a second shape.
export function recomputeCreatedHedgerowEdit(existing, edits) {
  const feature = withRootRetentionCategory(structuredClone(existing))
  feature.ref = edits.ref.trim()
  feature.proposed = proposedAttributes(feature.proposed, edits)
  clearEngineDerivedProposedFields(feature)
  return recomputePostInterventionHedgerow(feature, edits)
}
