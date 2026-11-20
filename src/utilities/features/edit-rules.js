// The service rule an edit to a post-intervention feature breaks, of those an
// edit is refused for rather than saved: an enhancement its baseline does not
// allow (edit-enhancement-rule.js), or an Existing tree Created over its
// baseline tree that the guide's steps for a tree whose condition gets worse
// would refuse (edit-degrade-rule.js). Split out of apply-feature-update.js, which
// turns each into its rejection.

import { brokenDegradeRule } from './edit-degrade-rule.js'
import { brokenEnhancementRule } from './edit-enhancement-rule.js'

export const EDIT_RULE_KIND = Object.freeze({
  enhancement: 'enhancement',
  degrade: 'degrade'
})

/**
 * @param {{ type: string, key: string, feature: object }} found the stored feature
 * @param {{ updatedFeature?: object }} derived
 * @param {{ documentKey: string, baseline?: object, serviceTemplate?: boolean }} context
 * @returns {{ kind: string, rule: string } | null} `kind` one of EDIT_RULE_KIND
 */
export function brokenEditRule(found, derived, context) {
  const enhancement = brokenEnhancementRule(found, derived, context.documentKey)
  if (enhancement) {
    return { kind: EDIT_RULE_KIND.enhancement, rule: enhancement }
  }
  const degrade = brokenDegradeRule(found, derived, context)
  return degrade ? { kind: EDIT_RULE_KIND.degrade, rule: degrade } : null
}
