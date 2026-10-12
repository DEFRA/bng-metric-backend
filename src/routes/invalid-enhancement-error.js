import Boom from '@hapi/boom'

import { ERROR_CODES } from '../validation/geopackage/errors.js'

// Shared 422 response for the feature-edit routes when an edit would leave an
// enhanced habitat that is not a valid enhancement of its baseline. Like
// outOfScopeDistinctivenessError, the request is well-formed but the value
// breaks a service rule. `rule` names the enhancement rule it breaks, as the
// import records it in `invalidEnhancement`.
export function invalidEnhancementError(rule) {
  const err = Boom.badData(
    `The proposed habitat is not a valid enhancement of its baseline (rule ${rule})`
  )
  err.output.payload.code = ERROR_CODES.ENHANCEMENT_NOT_VALID
  err.output.payload.rule = rule
  return err
}
