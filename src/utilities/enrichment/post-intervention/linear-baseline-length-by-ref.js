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
 * The measured lengths of a baseline's hedgerows and watercourses, in km: a
 * Map<parcelRef, lengthKm>, which a legacy upload's Enhanced feature is priced
 * against by its own ref, and `byFeatureId`, which a BNG Service template
 * feature is priced against through its parent link (BMD-1083). A template
 * feature's ref need not be its parent's, and a hedgerow and a watercourse
 * may share one, so it is never looked up by ref.
 */
class BaselineLinearLengths extends Map {
  /** @type {Map<string, number>} */
  byFeatureId = new Map()
}

/**
 * Build the BaselineLinearLengths of stored baseline hedgerows and
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
  const lengths = new BaselineLinearLengths()
  for (const feature of [...hedgerows, ...watercourses]) {
    if (typeof feature.sizeMetres !== 'number' || feature.sizeMetres <= 0) {
      continue
    }
    const lengthKm = linearLengthKmFromSizeMetres(feature.sizeMetres)
    const ref = normaliseRef(feature.ref)
    if (ref !== null) {
      lengths.set(ref, lengthKm)
    }
    if (feature.featureId) {
      lengths.byFeatureId.set(feature.featureId, lengthKm)
    }
  }
  return lengths
}

/**
 * The baseline length an Enhanced linear feature is priced against: its
 * parent's, when it is linked to one (a BNG Service template feature), else
 * the baseline feature's with its ref (a legacy feature).
 *
 * @param {{ ref?: string | null, parentFeatureId?: string }} feature
 * @param {Map<string, number> | undefined} baselineLengthByRef
 *   buildBaselineLinearLengthByRef's result
 * @param {string} layerLabel
 * @returns {number}
 * @throws {BaselineLookupError}
 */
export function lookupBaselineLinearLength(
  { ref, parentFeatureId },
  baselineLengthByRef,
  layerLabel
) {
  if (!baselineLengthByRef) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline data was provided (parcel ref "${ref}")`
    )
  }
  if (parentFeatureId) {
    const parentKm = baselineLengthByRef.byFeatureId?.get(parentFeatureId)
    if (parentKm == null) {
      throw new BaselineLookupError(
        `Cannot calculate Enhanced ${layerLabel} units: no baseline ${layerLabel} found for the parent of parcel ref "${ref}"`
      )
    }
    return parentKm
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
