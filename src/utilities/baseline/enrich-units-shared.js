/**
 * Constants and utilities shared between enrich-baseline-units.js and
 * enrich-post-intervention-units.js. Extracted here to avoid duplication
 * between the two enrichment modules.
 */

/** PostGIS areas are in square metres; the engine expects hectares. */
export const SQ_METRES_PER_HECTARE = 10_000

/** Linear feature sizes are stored in metres; the engine expects kilometres. */
export const METRES_PER_KM = 1000

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
