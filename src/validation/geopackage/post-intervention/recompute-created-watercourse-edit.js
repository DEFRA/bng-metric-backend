import { withRootRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { proposedAttributes } from './created-feature-edit.js'
import { enrichPostInterventionWatercourseWithUnits } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-watercourse.js'
import { clearEngineDerivedProposedFields } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'

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
