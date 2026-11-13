import Boom from '@hapi/boom'
import {
  resolveStoredTiming,
  validateReferenceAndTiming
} from './created-feature-edit.js'
import { getTreeCreationReference } from '../validation/reference/area-creation.js'
import {
  resolveRetentionCategory,
  RETENTION_CREATED,
  RETENTION_ENHANCED
} from '../utilities/enrichment/post-intervention/retention-category.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from '../validation/geopackage/tree-constants.js'
import { featureNotEditableError } from './feature-not-editable-error.js'

// A Created or Enhanced individual tree is edited as a Created area habitat
// is, with the same payload, but it stays a tree: its broad habitat is always
// Individual trees, and its habitat type is Urban tree or Rural tree. Its size
// is its size class times its Count, which the page shows and does not edit.
//
// An Enhanced tree enhances its condition only: its size, type and setting
// are its baseline tree's (tree-lineage.js), so its habitat type stays the one
// stored. Whether its target condition is better than its baseline one is
// checked where every edit is priced (apply-feature-update.js,
// brokenEnhancementRule), which refuses a worse one as ENHANCEMENT_NOT_VALID.
export { postInterventionAreaEditPayload as postInterventionTreeEditPayload } from './created-area-edit.js'

const EDITABLE_RETENTION = new Set([RETENTION_CREATED, RETENTION_ENHANCED])

// A Retained tree is refused with FEATURE_NOT_EDITABLE: no field on the form
// is to blame for it. Its reference is renamed through the feature route.
export function validatePostInterventionTreeEdit(feature, edits) {
  const retention = resolveRetentionCategory(feature)
  if (!EDITABLE_RETENTION.has(retention)) {
    throw featureNotEditableError(
      'Only a Created or Enhanced tree can be edited'
    )
  }
  if (!Object.hasOwn(edits, 'ref')) {
    throw Boom.badRequest(
      'A tree edit sends its reference, habitat, condition and timing together'
    )
  }
  const resolved = resolveStoredTiming(feature, edits)
  validateReferenceAndTiming(resolved)
  validateTreeChoices(resolved)
  if (
    retention === RETENTION_ENHANCED &&
    resolved.habitatType !== feature.proposed?.type
  ) {
    throw featureNotEditableError(
      'An Enhanced tree keeps its baseline tree’s Urban or Rural setting'
    )
  }
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
