// Reads a post-intervention feature into the shared orange-flag rules
// (BMD-822). The rules read the proposed side as the engine priced it, so this
// runs after pricing; FLAG8 compares it with the baseline side it enhances.

import {
  ORANGE_FLAG_UNIT_KIND_BY_LAYER,
  applyOrangeFlagsToDocument,
  derivePostInterventionOrangeFlags
} from '../shared/orange-flags.js'
import { resolveRetentionCategory } from './retention-category.js'

/**
 * @param {{ proposed?: object, baseline?: object, retentionCategory?: unknown }} feature
 * @param {string} layerKey the document layer the feature is in, e.g. 'habitats'
 * @returns {string[]}
 */
export function postInterventionFeatureOrangeFlags(feature, layerKey) {
  const proposed = feature.proposed ?? {}
  return derivePostInterventionOrangeFlags({
    unitKind: ORANGE_FLAG_UNIT_KIND_BY_LAYER[layerKey],
    category: resolveRetentionCategory(feature),
    type: proposed.type,
    broadType: proposed.broadType,
    condition: proposed.condition,
    advanceYears: proposed.advanceYears,
    delayYears: proposed.delayYears,
    standardTimeToTargetCondition: proposed.standardTimeToTargetCondition,
    distinctivenessScore: proposed.distinctivenessScore,
    baselineBroadType: feature.baseline?.broadType
  })
}

/**
 * Sets `orangeFlags` on every feature of a post-intervention document.
 *
 * @param {object | undefined} postInterventionDocument
 */
export function applyPostInterventionOrangeFlags(postInterventionDocument) {
  applyOrangeFlagsToDocument(
    postInterventionDocument,
    postInterventionFeatureOrangeFlags
  )
}
