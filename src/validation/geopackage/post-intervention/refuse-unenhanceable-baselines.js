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
  UNENHANCEABLE_BASELINE_LAYERS,
  checkBaselineEnhanceable
} from './enhancement-rules.js'

const SAMPLE_CAP = 50

const MESSAGE =
  'One or more habitats are enhanced, but their baseline habitat cannot be enhanced in this service'

/**
 * @param {object | undefined} baselineDocument
 * @param {string} layer
 * @returns {Map<string, object>} the layer's baseline features by featureId
 */
function parentsById(baselineDocument, layer) {
  return new Map(
    (baselineDocument?.[layer] ?? [])
      .filter((parent) => parent?.featureId)
      .map((parent) => [parent.featureId, parent])
  )
}

/**
 * The baseline habitat a feature enhances. A BNG Service template row linked
 * to its parent (BMD-1083, `parentFeatureId`) is checked against that parent
 * in the baseline saved with it, which is the true baseline: the row's own
 * Baseline columns are a copy that may have been edited since. Any other row
 * is checked against its own Baseline columns.
 *
 * @param {object} feature
 * @param {Map<string, object>} parents
 * @returns {object | undefined}
 */
function baselineOf(feature, parents) {
  return parents.get(feature.parentFeatureId) ?? feature.baseline
}

/**
 * @param {string} layer
 * @param {object} feature
 * @param {NonNullable<ReturnType<typeof checkBaselineEnhanceable>>} check
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
 * Check every Enhanced area habitat, hedgerow, watercourse and individual
 * tree of a post-intervention document, and refuse the file if any enhances a
 * baseline that cannot be enhanced. Runs on import, once a BNG Service
 * template file's rows are linked to their parents and before any enhancement
 * is nulled.
 *
 * @param {object} document the post-intervention document
 * @param {object} [baselineDocument] the baseline the document is imported
 *   against, whose features a linked row's `parentFeatureId` names
 * @returns {{ code: string, message: string, details: { count: number, sample: object[] } } | null}
 *   one error for every offending habitat together, or null when there are none
 */
export function refuseUnenhanceableBaselines(document, baselineDocument) {
  const offenders = []
  for (const layer of UNENHANCEABLE_BASELINE_LAYERS) {
    const parents = parentsById(baselineDocument, layer)
    for (const feature of document?.[layer] ?? []) {
      if (resolveRetentionCategory(feature) !== RETENTION_ENHANCED) {
        continue
      }
      const check = checkBaselineEnhanceable(
        layer,
        baselineOf(feature, parents)
      )
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
