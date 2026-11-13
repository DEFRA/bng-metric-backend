// The enhancement rule an edit to an Enhanced post-intervention feature
// breaks. Split out of apply-feature-update.js, which refuses the edit for it.

import {
  checkFeatureEnhancement,
  checkTreeEnhancement
} from '../../validation/geopackage/post-intervention/enhancement-rules.js'
import {
  RETENTION_ENHANCED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'

/**
 * The enhancement rule an edit to an enhanced post-intervention feature
 * breaks, or null. An edit must leave a valid enhancement of the feature's
 * baseline, as an import must (reject-invalid-enhancements.js); unlike an
 * import, it is refused rather than saved with its proposed values nulled.
 * The edit replaces only some proposed fields, so the check runs on the
 * recomputed feature, which carries all of them.
 *
 * @param {{ key: string }} found
 * @param {{ updatedFeature?: object }} derived
 * @param {string} documentKey
 * @returns {string | null} one of bng-library's ENHANCEMENT_RULE
 */
export function brokenEnhancementRule(found, derived, documentKey) {
  const feature = derived.updatedFeature
  if (
    documentKey !== 'postIntervention' ||
    !feature ||
    resolveRetentionCategory(feature) !== RETENTION_ENHANCED
  ) {
    return null
  }
  // An individual tree is outside the area rules: it enhances its condition
  // only, which must be better than its baseline tree's.
  const check =
    found.type === 'tree'
      ? checkTreeEnhancement(feature)
      : checkFeatureEnhancement(found.key, feature)
  return check && !check.valid ? check.rule : null
}
