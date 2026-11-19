// The guide's rule an edit to a habitat whose condition gets worse breaks:
// an Existing tree Created over its baseline tree, or an area habitat,
// vertical area habitat or hedgerow Created in its parent's own type. Split
// out of apply-feature-update.js, which refuses the edit for it, as
// edit-enhancement-rule.js is.

import {
  RETENTION_CREATED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'
import { isSameHabitatType } from '../../validation/geopackage/service-template/lineage/habitat-change.js'
import { isExistingTree } from '../../validation/geopackage/service-template/lineage/lineage-rows.js'
import {
  DEGRADE_CHECKS,
  breaksCheck,
  isJudged
} from '../../validation/geopackage/service-template/lineage/worsened-habitat-steps.js'

export { DEGRADE_RULE } from '../../validation/geopackage/service-template/lineage/worsened-habitat-steps.js'

/**
 * The layer each document key's features are judged as, as the Metric's
 * condition scores are keyed (habitat-change.js). Watercourses follow their
 * own rules, so an edit to one is not held to these steps.
 */
const LAYER_BY_KEY = Object.freeze({
  habitats: 'areas',
  verticalHabitats: 'verticalHabitats',
  hedgerows: 'hedgerows',
  trees: 'trees'
})

/**
 * A field as the rules read it: a blank timing is 0 years, as
 * worsened-habitat-steps.js reads it, and any other blank is null, so a stored
 * null and an edit's 0 or undefined are the same value.
 */
const BLANK_AS = Object.freeze({ advanceYears: 0, delayYears: 0 })
const readField = (side, field) => side[field] ?? BLANK_AS[field] ?? null

const changesAny = (fields, before, after) =>
  fields.some((field) => readField(before, field) !== readField(after, field))

/**
 * Whether a Created row is its parent created again in a lower condition, as
 * its layer reads it. A tree is the baseline tree when its Category is
 * Existing, in either setting. An area habitat, vertical area habitat or
 * hedgerow is when it is of its parent's own type: on the parent's land, as
 * its link to the parent says, a habitat cleared and put back gives a delay,
 * so one with none is a habitat that gets worse.
 */
function isCreatedOver(key, feature, parent, proposed) {
  if (key === 'trees') {
    return isExistingTree(feature.properties)
  }
  return isSameHabitatType(parent, proposed)
}

/**
 * The baseline parent a stored post-intervention feature is created over, or
 * undefined for a feature these steps do not apply to.
 */
function createdOverParent(found, baseline, proposed) {
  const { key, feature } = found
  if (
    !LAYER_BY_KEY[key] ||
    !feature.parentFeatureId ||
    resolveRetentionCategory(feature) !== RETENTION_CREATED
  ) {
    return undefined
  }
  const parent = baseline?.[key]?.find(
    (candidate) => candidate.featureId === feature.parentFeatureId
  )
  return parent && isCreatedOver(key, feature, parent, proposed)
    ? parent
    : undefined
}

/**
 * The guide's rule an edit to a habitat whose condition gets worse breaks, or
 * null. An edit must leave it in a lower condition and 30+ years in advance,
 * or put back after a delay, as an import must; it is refused, as an invalid
 * enhancement is (edit-enhancement-rule.js). The check runs on the recomputed
 * feature, which carries every proposed field.
 *
 * A feature left with no condition is Incomplete, and one whose condition, or
 * its parent's, has no score, such as "N/A - Other", has no lower or higher:
 * neither is refused, as an upload of one is not.
 *
 * A rule the feature already broke before the edit, while held to the steps,
 * such as after its parent was edited to the same condition, refuses only an
 * edit that changes the fields it is about: renaming it, or changing its
 * strategic significance or comment, is still saved. One the edit brings
 * under the steps, by giving it its parent's own type, is held to them all.
 *
 * @param {{ type: string, key: string, feature: object }} found the stored feature
 * @param {{ updatedFeature?: object }} derived
 * @param {{ documentKey: string, baseline?: object }} context
 * @returns {string | null} one of DEGRADE_RULE
 */
export function brokenDegradeRule(found, derived, { documentKey, baseline }) {
  const edited = derived.updatedFeature
  if (documentKey !== 'postIntervention' || !edited) {
    return null
  }
  const before = found.feature.proposed ?? {}
  const after = edited.proposed ?? {}
  const parent = createdOverParent(found, baseline, after)
  const layer = LAYER_BY_KEY[found.key]
  if (!parent || !isJudged(layer, parent, after)) {
    return null
  }
  // Held to the steps before the edit too: a row an edit turns into its
  // parent's own type, from another, is held to them whatever it broke before.
  const heldBefore =
    isCreatedOver(found.key, found.feature, parent, before) &&
    isJudged(layer, parent, before)
  const broken = DEGRADE_CHECKS.find(
    (check) =>
      breaksCheck(check, layer, parent, after) &&
      (!heldBefore ||
        !breaksCheck(check, layer, parent, before) ||
        changesAny(check.fields, before, after))
  )
  return broken?.rule ?? null
}
