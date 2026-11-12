import Boom from '@hapi/boom'

import { ERROR_CODES } from '../validation/geopackage/errors.js'

// Shared 400 response for the edit routes when the endpoint cannot carry the
// edit out on this feature: the feature is of a kind it does not edit, such as
// an Enhanced post-intervention tree, or the edit would make the feature
// something its kind cannot become, such as a tree that is no longer a tree
// (keepsTreeATree, BMD-1172).
//
// It stays a 400, as this refusal always was, but carries a code so the
// frontend can tell it apart from the bare 400 a refused reference gets:
// without one the details page blames the reference for a refusal that has
// nothing to do with it, or drops the user on an error page and loses the
// supporting information they typed.
export function featureNotEditableError(message) {
  const err = Boom.badRequest(message)
  err.output.payload.code = ERROR_CODES.FEATURE_NOT_EDITABLE
  return err
}
