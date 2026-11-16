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

/** Put back after a delay: a temporary loss the delay already discounts. */
const isPutBack = (proposed) => (proposed.delayYears ?? 0) > 0

/** "30+", which an import stores as 30 and an edit can send as either. */
const is30PlusYearsInAdvance = (proposed) =>
  (proposed.advanceYears ?? 0) >= MAX_YEARS

/**
 * Each rule, in the order the upload checks them: whether a proposed side
 * breaks it, whether a tree put back after a delay is exempt, and the fields
 * an edit changes it by.
 */
const DEGRADE_CHECKS = Object.freeze([
  {
    rule: DEGRADE_RULE.sameSetting,
    fields: ['type'],
    breaks: (parent, proposed) => !isSameHabitatType(parent, proposed)
  },
  {
    rule: DEGRADE_RULE.worseCondition,
    fields: ['condition', 'delayYears'],
    putBackExempt: true,
    breaks: (parent, proposed) => !isLowerCondition(TREES, parent, proposed)
  },
  {
    rule: DEGRADE_RULE.advance30Plus,
    fields: ['advanceYears', 'delayYears'],
    putBackExempt: true,
    breaks: (_parent, proposed) => !is30PlusYearsInAdvance(proposed)
  }
])

function breaksCheck(check, parent, proposed) {
  if (check.putBackExempt && isPutBack(proposed)) {
    return false
  }
  return check.breaks(parent, proposed)
}

const changesAny = (fields, before, after) =>
  fields.some((field) => before[field] !== after[field])

/**
 * The baseline tree a stored post-intervention tree is a degrade of: Created,
 * Category Existing, linked to it and in its setting, as lineage-outcomes.js
 * reads one when it records the parent as lost and created again. Undefined
 * for any other tree.
 */
function degradedParent(tree, baseline) {
  if (
    !tree.parentFeatureId ||
    resolveRetentionCategory(tree) !== RETENTION_CREATED ||
    !canDegrade(TREES, tree.properties)
  ) {
    return undefined
  }
  const parent = baseline?.trees?.find(
    (candidate) => candidate.featureId === tree.parentFeatureId
  )
  return parent && isSameHabitatType(parent, tree.proposed ?? {})
    ? parent
    : undefined
}

/**
 * The degrade rule an edit to a degraded tree breaks, or null. An edit must
 * leave the tree a degrade of its parent, as an import must; it is refused,
 * as an invalid enhancement is (edit-enhancement-rule.js), rather than turning
 * the parent's loss into something the file did not record. The check runs on
 * the recomputed feature, which carries every proposed field.
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
  const parent = degradedParent(found.feature, baseline)
  if (!parent) {
    return null
  }
  const before = found.feature.proposed ?? {}
  const after = edited.proposed ?? {}
  const broken = DEGRADE_CHECKS.find(
    (check) =>
      breaksCheck(check, parent, after) &&
      (!breaksCheck(check, parent, before) ||
        changesAny(check.fields, before, after))
  )
  return broken?.rule ?? null
}
