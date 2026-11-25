// What an individual tree edit may change, and the habitat-size summary it
// refreshes (BMD-1112): a baseline tree's, and a Created
// post-intervention tree's. Split out of apply-feature-update.js, which prices
// the edit.
//
// A BNG Service template tree's size class can be edited too (BMD-1172): a
// baseline tree's, and a Created tree's planted size. A Retained or Enhanced
// tree keeps its baseline tree's size, which it takes again when a baseline
// edit re-derives the post-intervention document (tree-lineage.js). A legacy
// tree's size stays as uploaded: its point can stand for several trees, and
// its kept trees do not follow their baseline tree's size.

import {
  INDIVIDUAL_TREES_BROAD_HABITAT,
  RURAL_TREE_TYPE,
  URBAN_TREE_TYPE
} from '../../validation/geopackage/tree-constants.js'
import {
  summarizeTreeSizes,
  treeAreaFields
} from '../../validation/geopackage/tree-sizes.js'
import {
  RETENTION_CREATED,
  resolveRetentionCategory
} from '../enrichment/post-intervention/retention-category.js'

/** The habitat types an individual tree can be edited to: its setting. */
const TREE_HABITAT_TYPES = new Set([URBAN_TREE_TYPE, RURAL_TREE_TYPE])

/**
 * A tree's habitat type as stored: a baseline tree's own, and a
 * post-intervention tree's proposed one.
 *
 * @param {object} tree
 * @param {string} documentKey
 * @returns {string | null}
 */
function storedTreeType(tree, documentKey) {
  const side = documentKey === 'postIntervention' ? tree?.proposed : tree
  return side?.type ?? null
}

/**
 * A tree's size class as stored: a baseline tree's own, and a
 * post-intervention tree's proposed one.
 *
 * @param {object} tree
 * @param {string} documentKey
 * @returns {string | null}
 */
function storedTreeSize(tree, documentKey) {
  const side = documentKey === 'postIntervention' ? tree?.proposed : tree
  return side?.treeSize ?? null
}

/**
 * Whether an edit changes a tree's size class. Sizes are read as the Metric
 * reads them, whatever their case, so a stored "Very Large" sent back as
 * "Very large" is no change.
 *
 * @param {object} tree the tree as stored
 * @param {{ treeSize?: string }} edits normalised
 * @param {string} documentKey
 * @returns {boolean}
 */
function changesTreeSize(tree, edits, documentKey) {
  return (
    edits.treeSize !== undefined &&
    edits.treeSize.toLowerCase() !==
      String(storedTreeSize(tree, documentKey) ?? '').toLowerCase()
  )
}

/**
 * Whether an edit may make the size change it asks for: none asked, or one to
 * a template upload's baseline tree or Created tree.
 *
 * @param {{ type: string, feature: object }} found the feature as stored
 * @param {{ treeSize?: string }} edits normalised
 * @param {{ documentKey: string, serviceTemplate: boolean }} context
 * @returns {boolean}
 */
export function allowsTreeSizeEdit(found, edits, context) {
  if (!changesTreeSize(found.feature, edits, context.documentKey)) {
    return true
  }
  if (found.type !== 'tree' || !context.serviceTemplate) {
    return false
  }
  return (
    context.documentKey !== 'postIntervention' ||
    resolveRetentionCategory(found.feature) === RETENTION_CREATED
  )
}

/**
 * The tree with the size class an edit gives it, and the area that size
 * class stands for, or the tree as it was when the edit leaves its size
 * alone. A post-intervention tree's size is its proposed one, and its area
 * is kept on its proposed side and on the row itself, as the upload keeps
 * them. The stored tree is not mutated.
 *
 * @param {object} tree
 * @param {{ treeSize?: string }} edits normalised
 * @param {string} documentKey
 * @returns {object}
 */
export function withEditedTreeSize(tree, edits, documentKey) {
  if (!changesTreeSize(tree, edits, documentKey)) {
    return tree
  }
  const size = treeAreaFields(edits.treeSize, tree.count)
  const sized = { ...tree, ...size }
  if (documentKey === 'postIntervention') {
    sized.proposed = { ...tree.proposed, treeSize: edits.treeSize, ...size }
  } else {
    sized.treeSize = edits.treeSize
  }
  return sized
}

/**
 * Whether an edit keeps a tree a tree: its broad habitat is always Individual
 * trees, and its habitat type is Urban tree or Rural tree (BMD-1172). Leaving
 * the type as stored is allowed whatever it is, so a tree imported without a
 * recognisable urban/rural column stays Incomplete and can still take a
 * comment.
 *
 * @param {object} existing the tree as stored
 * @param {{ broadType: string | null, habitatType: string | null }} edits normalised
 * @param {string} [documentKey] 'baseline' (the default) or 'postIntervention'
 * @returns {boolean}
 */
export function keepsTreeATree(existing, edits, documentKey = 'baseline') {
  if (edits.broadType !== INDIVIDUAL_TREES_BROAD_HABITAT) {
    return false
  }
  const type = edits.habitatType ?? null
  return (
    type === storedTreeType(existing, documentKey) ||
    TREE_HABITAT_TYPES.has(type)
  )
}

/**
 * The edited document's habitat-size summary after an edit that moves one of
 * its trees to another setting or size class, or undefined when the edit
 * leaves the summary as it was: an edit to anything else, one that keeps the
 * tree's type and size, or a document saved without a summary. The trees'
 * sizes are summed again, and the area habitats' total, which includes them,
 * moves by as much as the trees' total. A post-intervention tree is summed by
 * its proposed type, as the upload sums it (tree-lineage.js).
 *
 * @param {object} featureSet the edited document
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
  const unchanged =
    storedTreeType(found.feature, documentKey) ===
      storedTreeType(updatedFeature, documentKey) &&
    found.feature.sizeSquareMetres === updatedFeature.sizeSquareMetres
  if (found.type !== 'tree' || unchanged || !featureSet.habitatSizes) {
    return undefined
  }
  const sizes = featureSet.habitatSizes
  const trees = summarizeTreeSizes(featureSet.trees ?? [], (tree) =>
    storedTreeType(tree, documentKey)
  )
  const refreshed = { ...sizes, trees }
  const areaTotal = sizes.areaHabitats?.totalSquareMetres
  if (Number.isFinite(areaTotal)) {
    refreshed.areaHabitats = {
      ...sizes.areaHabitats,
      totalSquareMetres:
        areaTotal -
        (sizes.trees?.totalSquareMetres ?? 0) +
        trees.totalSquareMetres
    }
  }
  return refreshed
}
