import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-library/metric'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import { enrichPostInterventionAreaProposedSide } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-area-habitat.js'
import {
  clearEngineDerivedProposedFields,
  finalizePostInterventionFeatureStatus
} from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'
import { resolveAdvanceOrDelay } from '../../../utilities/enrichment/post-intervention/proposed-time-difficulty-display.js'

function storedYears(value) {
  return value === MAX_YEARS_PLUS ? MAX_YEARS : value
}

function proposedAttributes(existing, edits) {
  const advanceYears = storedYears(edits.advanceYears)
  const delayYears = storedYears(edits.delayYears)
  return {
    ...existing,
    broadType: edits.broadType,
    type: edits.habitatType,
    condition: edits.condition,
    strategicSignificance: edits.strategicSignificance,
    strategicSignificanceCategory: null,
    strategicSignificanceScore: null,
    rejectedStrategicSignificance: null,
    advanceYears,
    delayYears,
    advanceYearsIs30Plus: edits.advanceYears === MAX_YEARS_PLUS,
    delayYearsIs30Plus: edits.delayYears === MAX_YEARS_PLUS,
    advanceOrDelay:
      advanceYears != null && delayYears != null
        ? resolveAdvanceOrDelay(advanceYears, delayYears)
        : null
  }
}

// Preserve edited inputs, then use the same guards, pricing and result mapping
// as import/resync. No independent copy of the engine's reference calculations.
export function recomputeCreatedAreaEdit(existing, edits) {
  const feature = structuredClone(existing)
  feature.ref = edits.ref.trim()
  feature.proposed = proposedAttributes(feature.proposed, edits)
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
