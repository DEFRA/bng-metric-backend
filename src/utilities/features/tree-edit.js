// What a baseline individual tree edit may change, and the habitat-size
// summary it refreshes (BMD-1112, BMD-1172). Split out of
// apply-feature-update.js, which prices the edit.

import {
  INDIVIDUAL_TREES_BROAD_HABITAT,
  RURAL_TREE_TYPE,
  URBAN_TREE_TYPE
} from '../../validation/geopackage/tree-constants.js'
import { summarizeTreeSizes } from '../../validation/geopackage/tree-sizes.js'

/** The habitat types an individual tree can be edited to: its setting. */
const TREE_HABITAT_TYPES = new Set([URBAN_TREE_TYPE, RURAL_TREE_TYPE])

/**
 * Whether an edit keeps a tree a tree: its broad habitat is always Individual
 * trees, and its habitat type is Urban tree or Rural tree (BMD-1172). Leaving
 * the type as stored is allowed whatever it is, so a tree imported without a
 * recognisable urban/rural column stays Incomplete and can still take a
 * comment.
 *
 * @param {object} existing the tree as stored
 * @param {{ broadType: string | null, habitatType: string | null }} edits normalised
 * @returns {boolean}
 */
export function keepsTreeATree(existing, edits) {
  if (edits.broadType !== INDIVIDUAL_TREES_BROAD_HABITAT) {
    return false
  }
  const type = edits.habitatType ?? null
  return type === (existing.type ?? null) || TREE_HABITAT_TYPES.has(type)
}

/**
 * The baseline's habitat-size summary after an edit that moves one of its
 * trees to another setting, or undefined when the edit leaves the summary as
 * it was: an edit to anything else, one that keeps the tree's type, or a
 * baseline saved without a summary. Only the urban and rural split moves: a
 * tree edit cannot change a tree's area, so the trees' total and the area
 * habitats' total stay as stored.
 *
 * @param {object} featureSet the edited baseline
 * @param {{ type: string, feature: object }} found the feature as stored
 * @param {object} updatedFeature the feature as edited
 * @param {string} documentKey
 * @returns {object | undefined}
 */
export function withEditedTreeSizes(
  featureSet,
  found,
  updatedFeature,
  documentKey
) {
  if (
    documentKey !== 'baseline' ||
    found.type !== 'tree' ||
    (found.feature.type ?? null) === (updatedFeature.type ?? null) ||
    !featureSet.habitatSizes
  ) {
    return undefined
  }
  return {
    ...featureSet.habitatSizes,
    trees: summarizeTreeSizes(featureSet.trees ?? [], (tree) => tree.type)
  }
}
