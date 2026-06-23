import { BaselineLookupError } from './errors.js'
import { INDIVIDUAL_TREE_AREA_HECTARES } from './reference-constants.js'

// Individual trees are mapped as points, so their area is not measured from
// geometry — it is a fixed notional area per tree size, taken from the
// statutory metric reference data (individual-tree-area.json). Lookups are
// case-insensitive so "Very large" / "very large" both resolve.
const TREE_AREA_BY_NORMALISED_SIZE = new Map(
  Object.entries(INDIVIDUAL_TREE_AREA_HECTARES).map(([size, areaHectares]) => [
    size.toLowerCase(),
    areaHectares
  ])
)

/**
 * Resolve the notional area, in hectares, of a single individual tree of the
 * given size. This is the area fed into the area-habitat unit calculation.
 *
 * @param {string} treeSize - One of the keys in individual-tree-area.json
 *   (Small, Medium, Large, Very large), matched case-insensitively.
 * @returns {number} area in hectares
 * @throws {BaselineLookupError} If the size is empty or not a recognised size.
 * @example
 * getIndividualTreeAreaHectares('Medium') // => 0.0163
 */
export function getIndividualTreeAreaHectares(treeSize) {
  if (typeof treeSize !== 'string' || treeSize.trim() === '') {
    throw new BaselineLookupError('Tree size is empty or unrecognised')
  }
  const areaHectares = TREE_AREA_BY_NORMALISED_SIZE.get(
    treeSize.trim().toLowerCase()
  )
  if (areaHectares === undefined) {
    throw new BaselineLookupError(
      `Unrecognised individual tree size: ${treeSize}`
    )
  }
  return areaHectares
}
