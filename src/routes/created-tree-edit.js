import Boom from '@hapi/boom'
import { postInterventionAreaEditPayload } from './created-area-edit.js'
import {
  resolveStoredTiming,
  validateReferenceAndTiming
} from './created-feature-edit.js'
import { getTreeCreationReference } from '../validation/reference/area-creation.js'
import {
  resolveRetentionCategory,
  RETENTION_CREATED
} from '../utilities/enrichment/post-intervention/retention-category.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from '../validation/geopackage/tree-constants.js'
import { featureNotEditableError } from './feature-not-editable-error.js'

// A Created individual tree is edited as a Created area habitat is (BMD-1172),
// with the same payload, but it stays a tree: its broad habitat is always
// Individual trees, and its habitat type is Urban tree or Rural tree. Its size
// is its planted size class times its Count, which the page shows and does
// not edit.
export const postInterventionTreeEditPayload = postInterventionAreaEditPayload

export function validateCreatedTreeEdit(feature, edits) {
  if (resolveRetentionCategory(feature) !== RETENTION_CREATED) {
    throw Boom.badRequest('Only a Created tree can be edited')
  }
  if (!Object.hasOwn(edits, 'ref')) {
    throw Boom.badRequest(
      'A Created tree edit sends its reference, habitat, condition and timing together'
    )
  }
  const resolved = resolveStoredTiming(feature, edits)
  validateReferenceAndTiming(resolved)
  validateTreeChoices(resolved)
  return resolved
}

// A change to a non-tree habitat, or a blank habitat type, is refused with
// FEATURE_NOT_EDITABLE, as a baseline tree's is (keepsTreeATree), so the page
// does not blame the reference for it.
function validateTreeChoices(edits) {
  const type = getTreeCreationReference().habitatTypes.find(
    (t) => t.name === edits.habitatType
  )
  if (edits.broadType !== INDIVIDUAL_TREES_BROAD_HABITAT || !type) {
    throw featureNotEditableError(
      'A tree stays an Urban tree or a Rural tree in Individual trees'
    )
  }
  if (
    edits.condition &&
    !type?.conditions.some((c) => c.condition === edits.condition)
  ) {
    throw Boom.badRequest('Choose a valid target condition for the tree')
  }
}
