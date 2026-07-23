import { enrichPostInterventionAreaHabitat } from '../../utilities/baseline/enrich-post-intervention-area-habitat.js'
import { NO_OP_LOGGER } from '../../utilities/baseline/enrich-units-shared.js'
import { HABITAT_STATUS } from '../../services/baseline/calculate-habitat-statuses.js'

const PROPOSED_RECOMPUTE_KEYS = Object.freeze([
  'distinctiveness',
  'distinctivenessScore',
  'conditionScore',
  'timeMultiplier',
  'difficultyMultiplier',
  'standardTimeToTargetCondition',
  'difficulty',
  'advanceOrDelay',
  'finalTimeToTargetCondition'
])

/**
 * @param {object} proposed
 * @returns {Record<string, unknown>}
 */
function pickProposedRecomputeFields(proposed) {
  /** @type {Record<string, unknown>} */
  const fields = {}
  for (const key of PROPOSED_RECOMPUTE_KEYS) {
    fields[key] = proposed[key] ?? null
  }
  return fields
}

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
    ...pickProposedRecomputeFields(feature.proposed),
    units: feature.units ?? null,
    status: feature.status,
    updatedFeature: feature
  }
}
