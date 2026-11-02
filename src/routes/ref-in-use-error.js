import Boom from '@hapi/boom'

import { ERROR_CODES } from '../validation/geopackage/errors.js'

// Shared 422 response for the edit routes when a rename would give a habitat a
// reference another baseline habitat in the same layer already carries. Like
// outOfScopeDistinctivenessError, the request is well-formed but the value
// breaks a service rule, so the frontend can tell it apart by its code.
export function refInUseError(ref) {
  const err = Boom.badData(
    `Habitat reference '${ref}' is already used by another habitat`
  )
  err.output.payload.code = ERROR_CODES.HABITAT_REF_IN_USE
  return err
}
