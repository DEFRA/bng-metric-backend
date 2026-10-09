import { BaselineLookupError } from 'bng-library/metric'

import { normaliseRef } from '../../../validation/geopackage/carry-forward-feature-ids.js'
import { pricedLengthKm } from '../shared/enrich-units-shared.js'

/**
 * Convert a linear feature size in metres to kilometres, unrounded, matching
 * the length post-intervention enrichment prices on.
 *
 * @param {number} sizeMetres
 * @returns {number}
 */
export function linearLengthKmFromSizeMetres(sizeMetres) {
  return pricedLengthKm(sizeMetres)
}

/**
 * Build a Map<parcelRef, lengthKm> from stored baseline hedgerows and
 * watercourses. Used by Enhanced linear post-intervention calculations.
 *
 * Keyed by the normalised ref (normaliseRef), and looked up the same way, as
 * the ref carry-forward paths do. A post-intervention ref is stored cleaned
 * (trimmed, truncated, a number as text: BMD-1058), but a baseline saved
 * before that may hold ' H001', 12 or a ref over the length limit, so
 * matching the raw values would miss and leave the Enhanced feature unpriced.
 *
 * @param {object[]} [hedgerows]
 * @param {object[]} [watercourses]
 * @returns {Map<string, number>}
 */
export function buildBaselineLinearLengthByRef(
  hedgerows = [],
  watercourses = []
) {
  const lengthByRef = new Map()
  for (const feature of [...hedgerows, ...watercourses]) {
    const ref = normaliseRef(feature.ref)
    if (
      ref !== null &&
      typeof feature.sizeMetres === 'number' &&
      feature.sizeMetres > 0
    ) {
      lengthByRef.set(ref, linearLengthKmFromSizeMetres(feature.sizeMetres))
    }
  }
  return lengthByRef
}

/**
 * @param {string | null | undefined} ref
 * @param {Map<string, number> | undefined} baselineLengthByRef
 * @param {string} layerLabel
 * @returns {number}
 * @throws {BaselineLookupError}
 */
export function lookupBaselineLinearLength(
  ref,
  baselineLengthByRef,
  layerLabel
) {
  if (!baselineLengthByRef) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline data was provided (parcel ref "${ref}")`
    )
  }
  const key = normaliseRef(ref)
  const lengthKm = key === null ? undefined : baselineLengthByRef.get(key)
  if (lengthKm == null) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline ${layerLabel} found for parcel ref "${ref}"`
    )
  }
  return lengthKm
}
