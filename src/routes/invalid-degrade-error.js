import Boom from '@hapi/boom'

import { ERROR_CODES } from '../validation/geopackage/errors.js'

// Shared 422 response for the feature-edit routes when an edit would leave an
// Existing tree Created over its baseline tree, with no delay, not in a lower
// condition or not created 30+ years in advance. As invalidEnhancementError,
// the request is well-formed but the value breaks a service rule. `rule` names
// the rule it breaks (edit-degrade-rule.js, DEGRADE_RULE).
export function invalidDegradeError(rule) {
  const err = Boom.badData(
    `The tree is its baseline tree created again, so it must be in a lower condition and created 30+ years in advance, or put back after a delay (rule ${rule})`
  )
  err.output.payload.code = ERROR_CODES.TREE_DEGRADE_NOT_VALID
  err.output.payload.rule = rule
  return err
}
