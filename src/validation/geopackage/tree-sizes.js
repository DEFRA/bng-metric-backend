/**
 * Notional individual-tree area helpers shared between the baseline
 * (extract-habitat-data.js) and post-intervention (extract-post-intervention.js)
 * import paths. Trees are points, so their area is a fixed per-size lookup from
 * bng-library/metric rather than a PostGIS measurement; both paths derive the
 * same per-tree area and the same urban/rural size split from these helpers.
 */
import {
  getIndividualTreeAreaHectares,
  BaselineLookupError
} from 'bng-library/metric'

import { URBAN_TREE_TYPE, RURAL_TREE_TYPE } from './tree-constants.js'
import { isWholeTreeCount } from './tree-count-check.js'

/** Individual trees store area in hectares; persisted sizes are in m². */
export const SQ_METRES_PER_HECTARE = 10_000

/** A tree point with a blank "Count" stands for one tree, as the metric reads it. */
const DEFAULT_TREE_COUNT = 1

/**
 * The number of trees a tree point stands for: its "Count" column, or 1 when
 * the column is blank. Upload validation (tree-count-check.js) refuses a file
 * whose Count is filled in with anything but a whole number of trees, so the
 * fallback is only ever a blank by the time a document is built; it is kept
 * for any other value anyway so an unexpected one prices as one tree rather
 * than as nothing.
 *
 * @param {unknown} count
 * @returns {number}
 */
export function treeCountOrDefault(count) {
  return isWholeTreeCount(count) ? Number(count) : DEFAULT_TREE_COUNT
}

/**
 * Resolve the notional m² area for an individual-tree point: the per-size
 * reference area times the number of trees the point stands for (its "Count"
 * column), as the Statutory Biodiversity Metric prices it. Returns nulls for a
 * missing or unrecognised size so the feature is left without an area (and
 * therefore Incomplete).
 *
 * @param {unknown} treeSize
 * @param {unknown} [count] the point's "Count" column; 1 when absent
 * @returns {{ sizeSquareMetres: number, area: number } | { sizeSquareMetres: null, area: null }}
 */
export function treeAreaFields(treeSize, count = DEFAULT_TREE_COUNT) {
  try {
    // The per-size reference areas in m² are whole numbers (e.g. 0.0163 ha →
    // 163 m²); rounding removes floating-point noise without losing precision.
    const perTreeSquareMetres = Math.round(
      getIndividualTreeAreaHectares(treeSize) * SQ_METRES_PER_HECTARE
    )
    const sizeSquareMetres = perTreeSquareMetres * treeCountOrDefault(count)
    return { sizeSquareMetres, area: sizeSquareMetres }
  } catch (error) {
    if (error instanceof BaselineLookupError) {
      return { sizeSquareMetres: null, area: null }
    }
    throw error
  }
}

/**
 * Sum the notional tree areas (already embedded on each tree document), both
 * overall and grouped by urban/rural habitat type — the grouped totals the
 * system stores per habitat type. `getType` resolves a tree's urban/rural
 * habitat type, which lives on the top-level `type` in the baseline document but
 * on `proposed.type` in the post-intervention document.
 *
 * @param {object[]} treeDocuments
 * @param {(tree: object) => string | null} getType
 * @returns {{ totalSquareMetres: number, urbanSquareMetres: number, ruralSquareMetres: number }}
 */
export function summarizeTreeSizes(treeDocuments, getType) {
  // Sizes are summed per tree type; only the urban/rural buckets are read back,
  // so any unknown type still counts toward the total but not the split.
  const sizeByType = new Map()
  let totalSquareMetres = 0
  for (const tree of treeDocuments) {
    const size = tree.sizeSquareMetres
    if (typeof size !== 'number' || !Number.isFinite(size)) {
      continue
    }
    totalSquareMetres += size
    const type = getType(tree)
    sizeByType.set(type, (sizeByType.get(type) ?? 0) + size)
  }
  return {
    totalSquareMetres,
    urbanSquareMetres: sizeByType.get(URBAN_TREE_TYPE) ?? 0,
    ruralSquareMetres: sizeByType.get(RURAL_TREE_TYPE) ?? 0
  }
}
