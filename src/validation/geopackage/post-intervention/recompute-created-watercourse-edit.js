import { withRootRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { proposedAttributes } from './created-feature-edit.js'
import { enrichPostInterventionWatercourseWithUnits } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-watercourse.js'
import { clearEngineDerivedProposedFields } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'

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
  return {
    updatedFeature: feature,
    units: feature.units,
    status: feature.status,
    distinctiveness: feature.proposed.distinctiveness
  }
}
