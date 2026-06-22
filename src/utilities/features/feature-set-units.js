import {
  URBAN_TREE_TYPE,
  RURAL_TREE_TYPE
} from '../../validation/baseline/tree-constants.js'

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
 * @param {object[] | undefined} trees
 * @param {string} treeType
 * @returns {object[]}
 */
function treesOfType(trees, treeType) {
  if (!Array.isArray(trees)) {
    return []
  }
  return trees.filter((tree) => tree?.type === treeType)
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
