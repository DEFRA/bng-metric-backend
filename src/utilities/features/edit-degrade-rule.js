// The guide's rule an edit to an Existing tree Created over its baseline tree
// breaks. Split out of apply-feature-update.js, which refuses the edit for it,
// as edit-enhancement-rule.js is.

import {
  RETENTION_CREATED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import { isExistingTree } from '../../validation/geopackage/service-template/lineage/lineage-rows.js'
import {
  DEGRADE_CHECKS,
  breaksCheck
} from '../../validation/geopackage/service-template/lineage/worsened-tree-steps.js'

export { DEGRADE_RULE } from '../../validation/geopackage/service-template/lineage/worsened-tree-steps.js'

/**
 * A field as the rules read it: a blank timing is 0 years, as
 * worsened-tree-steps.js reads it, and any other blank is null, so a stored
 * null and an edit's 0 or undefined are the same value.
 */
const BLANK_AS = Object.freeze({ advanceYears: 0, delayYears: 0 })
const readField = (side, field) => side[field] ?? BLANK_AS[field] ?? null

const changesAny = (fields, before, after) =>
  fields.some((field) => readField(before, field) !== readField(after, field))

/**
 * The baseline tree a stored post-intervention tree is created over: Created,
 * Category Existing and linked to it, in either setting. Undefined for any
 * other tree.
 */
function createdOverParent(tree, baseline) {
  if (
    !tree.parentFeatureId ||
    resolveRetentionCategory(tree) !== RETENTION_CREATED ||
    !isExistingTree(tree.properties)
  ) {
    return undefined
  }
  return baseline?.trees?.find(
    (candidate) => candidate.featureId === tree.parentFeatureId
  )
}

/**
 * The guide's rule an edit to an Existing tree Created over its baseline tree
 * breaks, or null. An edit must leave it in a lower condition and 30+ years in
 * advance, or put back after a delay, as an import must; it is refused, as an
 * invalid enhancement is (edit-enhancement-rule.js). The check runs on the
 * recomputed feature, which carries every proposed field.
 *
 * A tree left with no condition is Incomplete, and not refused for it, as an
 * upload with no Proposed Condition is not.
 *
 * A rule the tree already broke before the edit, such as after its baseline
 * tree was edited to the same condition, refuses only an edit that changes
 * the fields it is about: renaming the tree, or changing its strategic
 * significance or comment, is still saved.
 *
 * @param {{ type: string, feature: object }} found the stored feature
 * @param {{ updatedFeature?: object }} derived
 * @param {{ documentKey: string, baseline?: object }} context
 * @returns {string | null} one of DEGRADE_RULE
 */
export function brokenDegradeRule(found, derived, { documentKey, baseline }) {
  const edited = derived.updatedFeature
  if (documentKey !== 'postIntervention' || found.type !== 'tree' || !edited) {
    return null
  }
  const parent = createdOverParent(found.feature, baseline)
  if (!parent) {
    return null
  }
  const before = found.feature.proposed ?? {}
  const after = edited.proposed ?? {}
  // With no condition the tree is Incomplete, as an upload leaves it.
  if (!after.condition) {
    return null
  }
  const broken = DEGRADE_CHECKS.find(
    (check) =>
      breaksCheck(check, parent, after) &&
      (!breaksCheck(check, parent, before) ||
        changesAny(check.fields, before, after))
  )
  return broken?.rule ?? null
}
