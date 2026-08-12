import Boom from '@hapi/boom'

import { ERROR_CODES } from '../validation/geopackage/errors.js'

// Shared 422 response for the feature-edit routes when a submitted habitat type
// resolves to an out-of-scope distinctiveness (High / V.High). Uses badData
// (422 Unprocessable Entity): the request is well-formed but the value violates
// the BNG Beta service scope. Carries the same error code the upload gate uses
// so API clients get a stable identifier.
export function outOfScopeDistinctivenessError(distinctiveness) {
  const err = Boom.badData(
    `Habitat distinctiveness '${distinctiveness}' is out of scope for the BNG Beta service`
  )
  err.output.payload.code = ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE
  return err
}
