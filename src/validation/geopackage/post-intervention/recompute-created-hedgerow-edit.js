import { calculateCreatedHedgerowPostIntervention } from 'bng-library/metric'
import { getHedgerowCreationReference } from '../../reference/hedgerow-creation.js'
import { resolveFinalTimeToTargetCondition } from '../../../utilities/enrichment/post-intervention/proposed-time-difficulty-display.js'
import { proposedAttributes } from './recompute-created-area-edit.js'
import { recomputePostInterventionHedgerow } from './recompute-post-intervention-hedgerow.js'
import { clearEngineDerivedProposedFields } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-shared.js'

export function recomputeCreatedHedgerowEdit(existing, edits) {
  const feature = structuredClone(existing)
  feature.ref = edits.ref.trim()
  feature.proposed = proposedAttributes(feature.proposed, edits)
  delete feature.proposed.broadType
  clearEngineDerivedProposedFields(feature)
  const result = recomputePostInterventionHedgerow(feature, edits)
  if (result.status === 'Incomplete') {
    result.units = 0
    result.updatedFeature.units = 0
    retainAvailableDerivedFields(result)
  }
  return result
}

// Missing pricing inputs must not discard values whose own inputs are present.
function retainAvailableDerivedFields(result) {
  const proposed = result.updatedFeature.proposed
  const type = getHedgerowCreationReference().habitatTypes.find(
    (t) => t.name === proposed.type
  )
  if (!type) {
    return
  }
  const condition = type.conditions.find(
    (c) => c.condition === proposed.condition
  )
  proposed.distinctiveness = type.distinctiveness
  proposed.distinctivenessScore = type.distinctivenessScore
  proposed.difficulty = type.difficulty
  proposed.difficultyMultiplier = type.difficultyMultiplier
  proposed.conditionScore = condition?.score ?? null
  proposed.standardTimeToTargetCondition = condition
    ? String(condition.years).replace('30+', '>30')
    : null
  result.distinctiveness = type.distinctiveness
  if (
    !condition ||
    proposed.advanceYears == null ||
    proposed.delayYears == null
  ) {
    return
  }
  const metrics = calculateCreatedHedgerowPostIntervention(
    1,
    type.name,
    condition.condition,
    proposed.advanceYears,
    proposed.delayYears,
    'Low'
  )
  proposed.timeMultiplier = metrics.timeMultiplier
  proposed.finalTimeToTargetCondition =
    resolveFinalTimeToTargetCondition(proposed)
}
