// The degrade rule an edit to a degraded individual tree breaks. Split out of
// apply-feature-update.js, which refuses the edit for it, as
// edit-enhancement-rule.js is.

import { MAX_YEARS } from 'bng-library/metric'

import {
  RETENTION_CREATED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import {
  isLowerCondition,
  isSameHabitatType
} from '../../validation/geopackage/service-template/lineage/habitat-change.js'
import { canDegrade } from '../../validation/geopackage/service-template/lineage/lineage-rows.js'

const TREES = 'trees'

/**
 * The rules a degraded tree is held to, as the upload holds it
 * (service-template/lineage/lineage-rules.js, checkDegradedRow): the baseline
 * tree itself, recorded as lost and created again (guide, "Habitat
 * retention"), so it stays in its parent's Urban or Rural setting, and,
 * unless it is put back after a delay, it is in a lower condition and created
 * 30+ years in advance.
 */
export const DEGRADE_RULE = Object.freeze({
  sameSetting: 'degrade-same-setting',
  worseCondition: 'degrade-worse-condition',
  advance30Plus: 'degrade-advance-30-plus'
})

/** The baseline tree a post-intervention tree is linked to, if any. */
function parentOf(tree, baseline) {
  return tree.parentFeatureId
    ? baseline?.trees?.find(
        (parent) => parent.featureId === tree.parentFeatureId
      )
    : undefined
}

/**
 * Whether a stored post-intervention tree is a degraded one: Created,
 * Category Existing, and in its parent's setting, as lineage-outcomes.js
 * reads one when it records the parent as lost and created again.
 */
function isDegradedTree(tree, parent) {
  return (
    Boolean(parent) &&
    resolveRetentionCategory(tree) === RETENTION_CREATED &&
    canDegrade(TREES, tree.properties) &&
    isSameHabitatType(parent, tree.proposed ?? {})
  )
}

/** "30+", which an import stores as 30 and an edit can send as either. */
const is30PlusYearsInAdvance = (proposed) =>
  (proposed.advanceYears ?? 0) >= MAX_YEARS

/**
 * The degrade rule an edit to a degraded tree breaks, or null. An edit must
 * leave the tree a degrade of its parent, as an import must; it is refused,
 * as an invalid enhancement is (edit-enhancement-rule.js), rather than turning
 * the parent's loss into something the file did not record. The check runs on
 * the recomputed feature, which carries every proposed field.
 *
 * @param {{ type: string, feature: object }} found the stored feature
 * @param {{ updatedFeature?: object }} derived
 * @param {{ documentKey: string, baseline?: object }} context
 * @returns {string | null} one of DEGRADE_RULE
 */
export function brokenDegradeRule(found, derived, { documentKey, baseline }) {
  if (documentKey !== 'postIntervention' || found.type !== 'tree') {
    return null
  }
  const parent = parentOf(found.feature, baseline)
  const edited = derived.updatedFeature
  if (!edited || !isDegradedTree(found.feature, parent)) {
    return null
  }
  const proposed = edited.proposed ?? {}
  if (!isSameHabitatType(parent, proposed)) {
    return DEGRADE_RULE.sameSetting
  }
  // Put back after a delay: a temporary loss the delay already discounts, so
  // it may be in any condition and needs no years in advance.
  if ((proposed.delayYears ?? 0) > 0) {
    return null
  }
  if (!isLowerCondition(TREES, parent, proposed)) {
    return DEGRADE_RULE.worseCondition
  }
  return is30PlusYearsInAdvance(proposed) ? null : DEGRADE_RULE.advance30Plus
}
