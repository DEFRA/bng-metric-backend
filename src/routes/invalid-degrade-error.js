import Boom from '@hapi/boom'

import { ERROR_CODES } from '../validation/geopackage/errors.js'

// Shared 422 response for the feature-edit routes when an edit would leave a
// habitat whose condition gets worse, with no delay, not in a lower condition
// or not created 30+ years in advance: an Existing tree Created over its
// baseline tree (TREE_DEGRADE_NOT_VALID), or an area habitat, vertical area
// habitat or hedgerow Created in its parent's own type
// (HABITAT_DEGRADE_NOT_VALID). As invalidEnhancementError, the request is
// well-formed but the value breaks a service rule. `rule` names the rule it
// breaks (edit-degrade-rule.js, DEGRADE_RULE).
const REFUSAL = Object.freeze({
  tree: {
    code: ERROR_CODES.TREE_DEGRADE_NOT_VALID,
    message:
      'The tree is its baseline tree created again, so it must be in a lower condition and created 30+ years in advance, or put back after a delay'
  },
  habitat: {
    code: ERROR_CODES.HABITAT_DEGRADE_NOT_VALID,
    message:
      'The habitat is its baseline habitat created again in its own type, so it must be in a lower condition and created 30+ years in advance, or put back after a delay'
  }
})

/**
 * @param {string} rule one of DEGRADE_RULE
 * @param {string} [type] the feature's type (find-feature.js); a tree's
 *   refusal names the tree, any other the habitat
 */
export function invalidDegradeError(rule, type) {
  const { code, message } = type === 'tree' ? REFUSAL.tree : REFUSAL.habitat
  const err = Boom.badData(`${message} (rule ${rule})`)
  err.output.payload.code = code
  err.output.payload.rule = rule
  return err
}
