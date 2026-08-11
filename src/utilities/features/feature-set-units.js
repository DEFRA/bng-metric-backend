import { calculatePostInterventionNetUnitChanges } from 'bng-metric-engine'

import {
  URBAN_TREE_TYPE,
  RURAL_TREE_TYPE
} from '../../validation/geopackage/tree-constants.js'

/**
 * Sum `units` on features that have a finite numeric value (uncalculated rows are skipped).
 *
 * @param {object[] | undefined} features
 * @returns {number}
 */
export function sumFeatureUnits(features) {
  if (!Array.isArray(features)) {
    return 0
  }
  let total = 0
  for (const feature of features) {
    const units = feature?.units
    if (typeof units === 'number' && Number.isFinite(units)) {
      total += units
    }
  }
  return total
}

/**
 * Resolve a tree's urban/rural habitat type. The baseline document stores it on
 * the top-level `type`; the post-intervention document stores it on the
 * `proposed` sub-object (top-level `type` is absent there).
 *
 * @param {object} tree
 * @returns {string | null}
 */
function treeTypeOf(tree) {
  return tree?.type ?? tree?.proposed?.type ?? null
}

/**
 * @param {object[] | undefined} trees
 * @param {string} treeType
 * @returns {object[]}
 */
function treesOfType(trees, treeType) {
  if (!Array.isArray(trees)) {
    return []
  }
  return trees.filter((tree) => treeTypeOf(tree) === treeType)
}

/**
 * Sets `featureSet.units` with cumulative units per layer and overall.
 * Individual trees contribute their own total (and urban/rural sub-totals, which
 * the story requires the system to store) and roll up into `totalUnits`.
 *
 * @param {{ habitats?: object[], trees?: object[], hedgerows?: object[], watercourses?: object[] }} featureSet
 * @returns {typeof featureSet}
 */
export function summarizeFeatureSetUnitsTotals(featureSet) {
  const habitatsTotal = sumFeatureUnits(featureSet?.habitats)
  const hedgerowsTotal = sumFeatureUnits(featureSet?.hedgerows)
  const watercoursesTotal = sumFeatureUnits(featureSet?.watercourses)

  const trees = featureSet?.trees
  const treesUrbanTotal = sumFeatureUnits(treesOfType(trees, URBAN_TREE_TYPE))
  const treesRuralTotal = sumFeatureUnits(treesOfType(trees, RURAL_TREE_TYPE))
  const treesTotal = sumFeatureUnits(trees)

  const totalUnits =
    habitatsTotal + hedgerowsTotal + watercoursesTotal + treesTotal

  featureSet.units = {
    totalUnits,
    habitatsTotal,
    hedgerowsTotal,
    watercoursesTotal,
    treesTotal,
    treesUrbanTotal,
    treesRuralTotal
  }
  return featureSet
}

/**
 * Adds net unit-change fields to post-intervention unit totals.
 *
 * Area habitats include individual trees, which are stored separately in the
 * persisted totals but are part of the area-habitat metric module.
 *
 * @param {{ units?: object }} postInterventionDocument
 * @param {object | undefined} baselineUnits
 * @returns {typeof postInterventionDocument}
 */
export function addPostInterventionNetUnitChanges(
  postInterventionDocument,
  baselineUnits
) {
  if (!postInterventionDocument?.units || !baselineUnits) {
    return postInterventionDocument
  }

  postInterventionDocument.units = {
    ...postInterventionDocument.units,
    ...calculatePostInterventionNetUnitChanges(
      baselineUnits,
      postInterventionDocument.units
    )
  }

  return postInterventionDocument
}
