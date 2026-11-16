// The supporting information shown on a Retained post-intervention habitat's
// details page (BMD-1187).
//
// A Retained habitat is its baseline parcel carried forward, so it shares that
// parcel's comment rather than keeping one of its own. An edit on the baseline
// details page (BMD-1112) is saved on the baseline feature alone: a legacy
// Retained row stores no comment, and a BNG Service template row's imported
// copy is left as it was (comment-check.js, commentForPostIntervention). So
// the comment is read from the baseline feature the row is joined to, found
// as the re-derive finds it, and the post-intervention row's own copy is not
// consulted.

import {
  RETENTION_RETAINED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import { resolveJoinedBaselineFeature } from '../enrichment/post-intervention/resync-post-intervention-baseline.js'

/**
 * Whether a post-intervention feature shares its baseline parcel's comment.
 *
 * @param {object} feature post-intervention feature
 * @returns {boolean}
 */
export function sharesBaselineComment(feature) {
  return resolveRetentionCategory(feature) === RETENTION_RETAINED
}

/**
 * The comment saved on the baseline feature a Retained post-intervention row
 * is joined to, or null when it has none, or when the row's parcel cannot be
 * told (no baseline feature carries its ref or names it as parent, or several
 * share its ref and its imported values pick out none).
 *
 * @param {object} feature a Retained post-intervention feature
 * @param {string} layer its document layer
 * @param {object[] | null | undefined} baselineFeatures the baseline's features in `layer`
 * @param {{ templateUpload: boolean }} options
 * @returns {string | null}
 */
export function retainedBaselineComment(
  feature,
  layer,
  baselineFeatures,
  { templateUpload }
) {
  const resolved = resolveJoinedBaselineFeature(
    feature,
    layer,
    { [layer]: baselineFeatures ?? [] },
    { templateUpload }
  )
  return resolved.source?.comment ?? null
}
