// Refuse a post-intervention file that enhances a baseline the service cannot
// enhance at all (BMD-1182). See enhancement-rules.js for the rules.
//
// An enhancement that is merely not valid for its baseline has its proposed
// side nulled instead (reject-invalid-enhancements.js), so the user can fix it
// in the service. One whose baseline cannot be enhanced into anything has no
// fix there: the row must be Retained, or the habitat lost and another
// created, in the file.

import {
  RETENTION_ENHANCED,
  resolveRetentionCategory
} from '../../../utilities/enrichment/post-intervention/retention-category.js'
import { ERROR_CODES, makeError } from '../errors.js'
import {
  ENHANCEMENT_RULE_LAYERS,
  checkFeatureBaselineEnhanceable
} from './enhancement-rules.js'

const SAMPLE_CAP = 50

const MESSAGE =
  'One or more habitats are enhanced, but their baseline habitat cannot be enhanced in this service'

/**
 * @param {string} layer
 * @param {object} feature
 * @param {NonNullable<ReturnType<typeof checkFeatureBaselineEnhanceable>>} check
 */
function offender(layer, feature, check) {
  return {
    layer,
    feature_ref: feature.ref ?? null,
    habitat_type: check.baseline.habitat,
    condition: check.baseline.condition,
    distinctiveness: check.baseline.distinctiveness,
    rule: check.rule,
    mvsOnly: check.mvsOnly
  }
}

function describeOffender({ layer, feature_ref: ref }) {
  return ref == null || ref === '' ? `a ${layer} feature` : `Feature Ref ${ref}`
}

/**
 * Check every Enhanced area habitat, hedgerow and watercourse of a
 * post-intervention document, and refuse the file if any enhances a baseline
 * that cannot be enhanced. Runs on import, once each feature's baseline side
 * is known (a BNG Service template file's is filled from its parent) and
 * before any enhancement is nulled.
 *
 * @param {object} document the post-intervention document
 * @returns {{ code: string, message: string, details: { count: number, sample: object[] } } | null}
 *   one error for every offending habitat together, or null when there are none
 */
export function refuseUnenhanceableBaselines(document) {
  const offenders = []
  for (const layer of ENHANCEMENT_RULE_LAYERS) {
    for (const feature of document?.[layer] ?? []) {
      if (resolveRetentionCategory(feature) !== RETENTION_ENHANCED) {
        continue
      }
      const check = checkFeatureBaselineEnhanceable(layer, feature)
      if (check) {
        offenders.push(offender(layer, feature, check))
      }
    }
  }
  if (offenders.length === 0) {
    return null
  }
  const sample = offenders.slice(0, SAMPLE_CAP)
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''
  return makeError(
    ERROR_CODES.BASELINE_NOT_ENHANCEABLE,
    `${MESSAGE}: ${sample.map(describeOffender).join(', ')}${more}`,
    { count: offenders.length, sample }
  )
}
