import { enrichPostInterventionAreaHabitat } from '../../utilities/baseline/enrich-post-intervention-area-habitat.js'
import { NO_OP_LOGGER } from '../../utilities/baseline/enrich-units-shared.js'
import { HABITAT_STATUS } from '../../services/baseline/calculate-habitat-statuses.js'

/**
 * Recompute post-intervention area-habitat units after a dropdown edit, using
 * the same retention-category dispatch as upload enrichment.
 *
 * @param {object} existing — persisted post-intervention habitat feature
 * @param {{ broadType: string | null, habitatType: string | null, condition: string | null }} edits
 * @returns {{
 *   distinctiveness: string | null,
 *   distinctivenessScore: number | null,
 *   conditionScore: number | null,
 *   timeMultiplier: number | null,
 *   difficultyMultiplier: number | null,
 *   standardTimeToTargetCondition: string | null,
 *   difficulty: string | null,
 *   advanceOrDelay: string | null,
 *   finalTimeToTargetCondition: string | null,
 *   units: number | null,
 *   status: 'Complete' | 'Incomplete',
 *   updatedFeature: object
 * }}
 */
export function recomputePostInterventionAreaHabitat(existing, edits) {
  const feature = structuredClone(existing)
  feature.proposed = {
    ...feature.proposed,
    broadType: edits.broadType,
    type: edits.habitatType,
    condition: edits.condition
  }
  feature.units = null
  feature.status = HABITAT_STATUS.INCOMPLETE

  enrichPostInterventionAreaHabitat(feature, NO_OP_LOGGER)

  return {
    distinctiveness: feature.proposed.distinctiveness ?? null,
    distinctivenessScore: feature.proposed.distinctivenessScore ?? null,
    conditionScore: feature.proposed.conditionScore ?? null,
    timeMultiplier: feature.proposed.timeMultiplier ?? null,
    difficultyMultiplier: feature.proposed.difficultyMultiplier ?? null,
    standardTimeToTargetCondition:
      feature.proposed.standardTimeToTargetCondition ?? null,
    difficulty: feature.proposed.difficulty ?? null,
    advanceOrDelay: feature.proposed.advanceOrDelay ?? null,
    finalTimeToTargetCondition:
      feature.proposed.finalTimeToTargetCondition ?? null,
    units: feature.units ?? null,
    status: feature.status,
    updatedFeature: feature
  }
}
