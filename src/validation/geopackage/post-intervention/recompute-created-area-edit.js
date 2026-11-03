import { withRootRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import { enrichPostInterventionAreaProposedSide } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-area-habitat.js'
import {
  clearEngineDerivedProposedFields,
  finalizePostInterventionFeatureStatus
} from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'
import { proposedAttributes } from './created-feature-edit.js'

// Preserve edited inputs, then use the same guards, pricing and result mapping
// as import/resync. No independent copy of the engine's reference calculations.
export function recomputeCreatedAreaEdit(existing, edits) {
  const feature = withRootRetentionCategory(structuredClone(existing))
  feature.ref = edits.ref.trim()
  feature.proposed = {
    ...proposedAttributes(feature.proposed, edits),
    broadType: edits.broadType
  }
  clearEngineDerivedProposedFields(feature)
  enrichPostInterventionAreaProposedSide(feature, NO_OP_LOGGER)
  finalizePostInterventionFeatureStatus(feature)
  return {
    distinctiveness: feature.proposed.distinctiveness,
    units: feature.units,
    status: feature.status,
    updatedFeature: feature
  }
}
