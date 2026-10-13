// Null the proposed side of every enhancement that is not valid for its
// baseline. See enhancement-rules.js for the rules.

import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'
import {
  RETENTION_ENHANCED,
  resolveRetentionCategory
} from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import {
  ENHANCEMENT_RULE_LAYERS,
  checkFeatureEnhancement
} from './enhancement-rules.js'

const LOG_PREFIX = 'rejectInvalidEnhancements: '

/** The `event` field of the warning logged for each rejected enhancement. */
export const ENHANCEMENT_INVALID_EVENT = 'enhancement-invalid'

/**
 * Keep only the shape, habitat reference and intervention type: every
 * proposed attribute is nulled, so the habitat is saved Incomplete with the
 * rule it broke. The baseline side is what the enhancement was checked
 * against, so it stays. The raw GeoPackage columns stay in `properties`, as
 * the record of what was imported.
 *
 * @param {object} feature
 * @param {string} rule
 */
function applyInvalidEnhancement(feature, rule) {
  for (const field of Object.keys(feature.proposed)) {
    feature.proposed[field] = null
  }
  feature.invalidEnhancement = rule
  feature.status = HABITAT_STATUS.INCOMPLETE
}

/**
 * @param {object} feature
 * @param {string} layer
 * @param {{ warn: (fields: object, msg: string) => void }} logger
 * @returns {boolean} whether the enhancement was rejected
 */
function rejectIfInvalid(feature, layer, logger) {
  if (resolveRetentionCategory(feature) !== RETENTION_ENHANCED) {
    return false
  }
  const check = checkFeatureEnhancement(layer, feature)
  if (!check || check.valid) {
    return false
  }
  logger.warn(
    {
      event: ENHANCEMENT_INVALID_EVENT,
      layer,
      featureId: feature.featureId ?? null,
      ref: feature.ref ?? null,
      rule: check.rule,
      baseline: check.baseline,
      proposed: check.proposed
    },
    `${LOG_PREFIX}${layer} featureId ${feature.featureId ?? 'unknown'}: enhancement from ${check.baseline.habitat} (${check.baseline.condition}) to ${check.proposed.habitat} (${check.proposed.condition}) breaks rule ${check.rule} — proposed attributes nulled`
  )
  applyInvalidEnhancement(feature, check.rule)
  return true
}

/**
 * Check every enhanced area habitat, hedgerow and watercourse of an imported
 * post-intervention document against the enhancement rules, and null the
 * proposed attributes of each one that breaks them. Runs on import only,
 * before enrichment, so a rejected enhancement is never priced. Mutates
 * `document`.
 *
 * @param {object} document the post-intervention document
 * @param {{ warn: (fields: object, msg: string) => void }} [logger]
 * @returns {number} how many enhancements were rejected
 */
export function rejectInvalidEnhancements(document, logger = NO_OP_LOGGER) {
  let rejected = 0
  for (const layer of ENHANCEMENT_RULE_LAYERS) {
    for (const feature of document?.[layer] ?? []) {
      if (rejectIfInvalid(feature, layer, logger)) {
        rejected += 1
      }
    }
  }
  return rejected
}
