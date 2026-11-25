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
import { postInterventionAreaEditPayload } from './post-intervention-area-edit.js'

// A Created or Enhanced individual tree is edited as a Created area habitat
// is, with the same payload, but it stays a tree: its broad habitat is always
// Individual trees, and its habitat type is Urban tree or Rural tree. Its size
// is its size class's area: a Created tree's planted size class can be
// edited (`treeSize`), and the tree is priced at that size class's area.
//
// An Enhanced tree enhances its condition only: its size, type and setting
// are its baseline tree's (tree-lineage.js), so its habitat type and size
// class stay the ones stored. Whether its target condition is better than its baseline one is
// checked where every edit is priced (apply-feature-update.js,
// brokenEnhancementRule), which refuses a worse one as ENHANCEMENT_NOT_VALID.
// An Existing tree Created over its baseline tree is held there to the guide's
// steps for a tree whose condition gets worse (brokenDegradeRule), and
// refused as TREE_DEGRADE_NOT_VALID.
export const postInterventionTreeEditPayload =
  postInterventionAreaEditPayload.with('treeSize', 'ref')

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
  // A Created or Enhanced tree's comment is its supporting information
  // (BMD-1153, BMD-1190), saved with this edit.
  const resolved = resolveStoredTiming(feature, edits)
  validateReferenceAndTiming(resolved)
  validateTreeChoices(resolved)
  if (
    retention === RETENTION_ENHANCED &&
    resolved.habitatType !== enhancedTreeSetting(feature)
  ) {
    throw featureNotEditableError(
      'An Enhanced tree keeps its baseline tree’s Urban or Rural setting'
    )
  }
  if (retention === RETENTION_ENHANCED && changesSize(feature, resolved)) {
    throw featureNotEditableError(
      'An Enhanced tree keeps its baseline tree’s size'
    )
  }
  return resolved
}

// An Enhanced tree's setting: its proposed one, or, where its file left that
// blank, its baseline one. The upload gives a linked Enhanced tree its
// parent's setting (tree-lineage.js, alignTreesWithParents). A legacy
// upload's trees, and a template tree that names no parent, keep the setting
// their file gave.
function enhancedTreeSetting(feature) {
  return feature.proposed?.type ?? feature.baseline?.type ?? null
}

// Whether an edit sends a size class other than the tree's stored one,
// whatever its case.
function changesSize(feature, edits) {
  return (
    edits.treeSize !== undefined &&
    edits.treeSize.toLowerCase() !==
      String(feature.proposed?.treeSize ?? '').toLowerCase()
  )
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
