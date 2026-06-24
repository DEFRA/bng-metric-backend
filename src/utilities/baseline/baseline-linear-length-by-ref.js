import { BaselineLookupError } from 'bng-metric-engine'

import { METRES_PER_KM } from './enrich-units-shared.js'

/**
 * Convert a linear feature size in metres to kilometres, matching the rounding
 * applied during post-intervention enrichment (`Math.round(sizeMetres)`).
 *
 * @param {number} sizeMetres
 * @returns {number}
 */
export function linearLengthKmFromSizeMetres(sizeMetres) {
  return Math.round(sizeMetres) / METRES_PER_KM
}

/**
 * Build a Map<parcelRef, lengthKm> from stored baseline hedgerows and
 * watercourses. Used by Enhanced linear post-intervention calculations.
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
    if (
      feature.ref != null &&
      typeof feature.sizeMetres === 'number' &&
      feature.sizeMetres > 0
    ) {
      lengthByRef.set(
        feature.ref,
        linearLengthKmFromSizeMetres(feature.sizeMetres)
      )
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
  const lengthKm = baselineLengthByRef.get(ref)
  if (lengthKm == null) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline ${layerLabel} found for parcel ref "${ref}"`
    )
  }
  return lengthKm
}
