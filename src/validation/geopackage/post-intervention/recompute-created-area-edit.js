import { withRootRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import { enrichPostInterventionAreaProposedSide } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-area-habitat.js'
import {
  clearEngineDerivedProposedFields,
  finalizePostInterventionFeatureStatus
} from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'
import { proposedAttributes } from './created-feature-edit.js'
import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'

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
  // BMD-1048 AC11 Scenario B: saving the form with an attribute the calculation
  // needs left blank saves zero units. Imports and recalculations keep
  // BMD-1070's null units.
  if (feature.status === HABITAT_STATUS.INCOMPLETE) {
    feature.units = 0
  }
  return {
    distinctiveness: feature.proposed.distinctiveness,
    units: feature.units,
    status: feature.status,
    updatedFeature: feature
  }
}
