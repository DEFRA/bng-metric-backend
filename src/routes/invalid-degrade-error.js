import Boom from '@hapi/boom'

import { ERROR_CODES } from '../validation/geopackage/errors.js'

// Shared 422 response for the feature-edit routes when an edit would leave a
// degraded tree, the baseline tree recorded as lost and created again, no
// longer a degrade of it. As invalidEnhancementError, the request is
// well-formed but the value breaks a service rule. `rule` names the degrade
// rule it breaks (edit-degrade-rule.js, DEGRADE_RULE).
export function invalidDegradeError(rule) {
  const err = Boom.badData(
    `The tree is no longer its baseline tree recorded as lost and created again in a lower condition (rule ${rule})`
  )
  err.output.payload.code = ERROR_CODES.DEGRADE_NOT_VALID
  err.output.payload.rule = rule
  return err
}
