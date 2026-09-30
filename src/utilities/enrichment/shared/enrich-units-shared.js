/**
 * Constants and utilities shared between enrich-baseline-units.js and
 * enrich-post-intervention-units.js. Extracted here to avoid duplication
 * between the two enrichment modules.
 */

// PostGIS areas are in square metres; the engine expects hectares. Re-exported
// from tree-sizes.js (the single source of truth) so the enrichment modules can
// keep importing it from here without a second definition that could drift.
import { SQ_METRES_PER_HECTARE } from '../../../validation/geopackage/tree-sizes.js'

export { SQ_METRES_PER_HECTARE }

/** Linear feature sizes are stored in metres; the engine expects kilometres. */
export const METRES_PER_KM = 1000

function isPositiveFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * The area, in hectares, an area habitat's units are priced on: its measured
 * size, unrounded. The metric prices "the true value entered in each row", to
 * any number of decimal places (User Guide, July 2025, Appendix Table F), so
 * rounding to the whole square metre first would drift from it (BMD-1042).
 * The rounded `area` is only a fallback, for documents stored before
 * `sizeSquareMetres` was.
 *
 * @param {{ sizeSquareMetres?: number | null, area?: number | null }} habitat
 * @returns {number | null} hectares, or null when there is no positive size
 */
export function pricedAreaHectares(habitat) {
  const squareMetres = isPositiveFinite(habitat?.sizeSquareMetres)
    ? habitat.sizeSquareMetres
    : habitat?.area
  return isPositiveFinite(squareMetres)
    ? squareMetres / SQ_METRES_PER_HECTARE
    : null
}

/**
 * The length, in kilometres, a hedgerow or watercourse is priced on: its
 * measured size, unrounded, for the same reason as {@link pricedAreaHectares}.
 * The caller has already checked `sizeMetres` is positive.
 *
 * @param {number} sizeMetres
 * @returns {number}
 */
export function pricedLengthKm(sizeMetres) {
  return sizeMetres / METRES_PER_KM
}

/** @type {{ warn: (msg: string) => void }} */
export const NO_OP_LOGGER = { warn: () => {} }

/**
 * Iterate over `collection` calling `enricher(item, logger)` for each element.
 * Does nothing when `collection` is empty or not an array.
 *
 * @template T
 * @param {T[] | undefined} collection
 * @param {(item: T, logger: { warn: (msg: string) => void }) => void} enricher
 * @param {{ warn: (msg: string) => void }} logger
 */
export function enrichCollectionIfNonEmpty(collection, enricher, logger) {
  if (Array.isArray(collection) && collection.length > 0) {
    for (const item of collection) {
      enricher(item, logger)
    }
  } else {
    // empty or absent collection — nothing to enrich
  }
}
