import {
  summarizeTreeSizes,
  treeAreaFields
} from '../../../validation/geopackage/tree-sizes.js'
import {
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'

/**
 * What a BNG Service template upload's Retained and Enhanced trees take from
 * the baseline tree they are linked to (`parentFeatureId`), worked out on the
 * saved documents before they are priced, and again when a baseline edit
 * re-derives the post-intervention document.
 *
 * The Metric does not record the growth of a kept tree (guide, "Recording
 * planted individual trees at post-development"), so a Retained or Enhanced
 * tree keeps its parent's size class, Native or Non-native type and Urban or
 * Rural setting, whatever its Proposed columns say. A Retained tree keeps its
 * parent's condition and strategic significance too; an Enhanced one keeps
 * the condition and strategic significance it proposes. Either is priced for
 * its own Count, so one with fewer trees than its parent loses the difference
 * (lineage-outcomes.js).
 *
 * The row's own Baseline columns are a copy of its parent's that may have
 * been edited since, so its baseline side is set from the parent as well: the
 * enhancement it records is checked against the true baseline.
 *
 * A Created tree, linked to a parent or not, is new planting at its own size,
 * and is left as it is.
 */

/** What a tree is, on either side: the fields a kept tree takes from its parent. */
const TREE_IDENTITY_FIELDS = Object.freeze([
  'type',
  'broadType',
  'treeSize',
  'treeSpecies',
  'ruralOrUrban'
])

/** What a Retained tree takes from its parent besides. */
const RETAINED_TREE_FIELDS = Object.freeze(['condition'])

const CONTINUING = new Set([RETENTION_RETAINED, RETENTION_ENHANCED])

/**
 * @param {object} side a tree's baseline or proposed side, mutated
 * @param {object} parent the baseline tree
 * @param {readonly string[]} fields
 * @param {{ sizeSquareMetres: number | null, area: number | null }} size
 */
function takeFromParent(side, parent, fields, size) {
  for (const field of fields) {
    side[field] = parent[field] ?? null
  }
  side.sizeSquareMetres = size.sizeSquareMetres
  side.area = size.area
}

/**
 * Give each linked Retained and Enhanced tree its parent's identity, priced
 * for its own Count. Mutates `postIntervention`.
 *
 * @param {object} postIntervention the post-intervention document, linked
 * @param {object} baseline the baseline document saved with it
 * @returns {object[]} the trees aligned
 */
export function alignTreesWithParents(postIntervention, baseline) {
  const parents = new Map(
    (baseline?.trees ?? []).map((parent) => [parent.featureId, parent])
  )
  const aligned = []
  for (const tree of postIntervention?.trees ?? []) {
    const parent = parents.get(tree.parentFeatureId)
    const retention = resolveRetentionCategory(tree)
    if (!parent || !CONTINUING.has(retention)) {
      continue
    }
    const size = treeAreaFields(parent.treeSize, tree.count)
    const fields =
      retention === RETENTION_RETAINED
        ? [...TREE_IDENTITY_FIELDS, ...RETAINED_TREE_FIELDS]
        : TREE_IDENTITY_FIELDS
    tree.baseline ??= {}
    tree.proposed ??= {}
    takeFromParent(
      tree.baseline,
      parent,
      [...TREE_IDENTITY_FIELDS, ...RETAINED_TREE_FIELDS],
      size
    )
    takeFromParent(tree.proposed, parent, fields, size)
    if (retention === RETENTION_RETAINED) {
      tree.proposed.strategicSignificance = tree.baseline.strategicSignificance
    }
    tree.sizeSquareMetres = size.sizeSquareMetres
    tree.area = size.area
    aligned.push(tree)
  }
  return aligned
}

const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0)

/**
 * Work the document's tree sizes out again, after alignTreesWithParents has
 * given its kept trees their parents' size class and setting: the extract
 * summed them as the file proposed them. The area habitats' total includes
 * the trees, so it is worked out again from its parts, the site, the trees
 * and the vertical area habitats, as the extract builds it. A document with
 * no habitatSizes is left without one. Mutates `postIntervention`.
 *
 * @param {object} postIntervention
 */
export function refreshTreeHabitatSizes(postIntervention) {
  const sizes = postIntervention?.habitatSizes
  if (!sizes) {
    return
  }
  sizes.trees = summarizeTreeSizes(
    postIntervention.trees ?? [],
    (tree) => tree.proposed?.type
  )
  sizes.areaHabitats = {
    ...sizes.areaHabitats,
    totalSquareMetres:
      finiteOrZero(sizes.site?.totalSquareMetres) +
      sizes.trees.totalSquareMetres +
      finiteOrZero(sizes.verticalHabitats?.totalSquareMetres)
  }
}
