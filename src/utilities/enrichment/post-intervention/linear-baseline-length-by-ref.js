import { BaselineLookupError } from 'bng-library/metric'

import { normaliseRef } from '../../../validation/geopackage/carry-forward-feature-ids.js'
import {
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'
import { pricedLengthKm } from '../shared/enrich-units-shared.js'
import { shownValue } from '../../../validation/geopackage/text-limits.js'

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

  /**
   * The baseline length each Enhanced part of a split BNG Service watercourse
   * is priced against, keyed by the post-intervention feature itself (see
   * withEnhancedWatercourseShares). Empty until that runs.
   *
   * @type {WeakMap<object, number>}
   */
  enhancedShareByFeature = new WeakMap()
}

const hasPositiveSize = (feature) =>
  typeof feature.sizeMetres === 'number' && feature.sizeMetres > 0

const sumKm = (features) =>
  features.reduce(
    (total, feature) =>
      total + linearLengthKmFromSizeMetres(feature.sizeMetres),
    0
  )

/** One parent's Enhanced parts, each with its share of what Retained leaves. */
function shareRemainder(parentKm, parts, shares) {
  const byCategory = (category) =>
    parts.filter(
      (part) =>
        resolveRetentionCategory(part) === category && hasPositiveSize(part)
    )
  const enhanced = byCategory(RETENTION_ENHANCED)
  const enhancedKm = sumKm(enhanced)
  if (enhanced.length === 0 || enhancedKm <= 0) {
    return
  }
  const remainderKm = Math.max(
    0,
    parentKm - sumKm(byCategory(RETENTION_RETAINED))
  )
  for (const part of enhanced) {
    shares.set(
      part,
      (remainderKm * linearLengthKmFromSizeMetres(part.sizeMetres)) / enhancedKm
    )
  }
}

/**
 * The baseline lengths, with the share of its parent each Enhanced BNG
 * Service watercourse is priced against (BMD-1212).
 *
 * The Metric records a re-meandered watercourse by splitting its baseline
 * section into a retained and an enhanced section, with the total enhanced
 * length in the enhanced one and no loss of length (User Guide, section 7,
 * Watercourse enhancement); one baseline row both retained and enhanced it
 * refuses. So an Enhanced part is priced against what its parent's Retained
 * parts leave, not the whole parent: 100 m kept 40 m and re-meandered into
 * 90 m is a 60 m section enhanced to 90 m. Several Enhanced parts of one
 * parent share that remainder in proportion to their drawn lengths. A single
 * Enhanced part with no Retained sibling keeps the whole parent, as before.
 * A Created part takes nothing from it: it is a loss and a creation.
 *
 * Only watercourses linked to a parent (the BNG Service template): a legacy
 * watercourse is priced by its own ref, unchanged. Hedgerows are unchanged.
 *
 * @param {BaselineLinearLengths | undefined} baselineLengthByRef
 *   buildBaselineLinearLengthByRef's result
 * @param {object[]} [watercourses] the post-intervention watercourses
 * @returns {BaselineLinearLengths | undefined} a copy with
 *   `enhancedShareByFeature` filled; the argument itself is left as it is
 */
export function withEnhancedWatercourseShares(
  baselineLengthByRef,
  watercourses = []
) {
  if (!baselineLengthByRef?.byFeatureId) {
    return baselineLengthByRef
  }
  const lengths = new BaselineLinearLengths(baselineLengthByRef)
  lengths.byFeatureId = baselineLengthByRef.byFeatureId
  const linked = watercourses.filter(
    (feature) =>
      feature?.parentFeatureId &&
      lengths.byFeatureId.has(feature.parentFeatureId)
  )
  for (const [parentId, parts] of Map.groupBy(
    linked,
    (feature) => feature.parentFeatureId
  )) {
    shareRemainder(
      lengths.byFeatureId.get(parentId),
      parts,
      lengths.enhancedShareByFeature
    )
  }
  return lengths
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
 * A linked Enhanced feature's share of its parent's length, or the whole
 * parent when it has none. A share of nothing (Retained parts as long as the
 * parent) leaves no baseline to enhance, so the feature cannot be priced.
 */
function shareOfParent(feature, parentKm, baselineLengthByRef, layerLabel) {
  const shareKm = baselineLengthByRef.enhancedShareByFeature?.get(feature)
  if (shareKm == null) {
    return parentKm
  }
  if (shareKm <= 0) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: the Retained parts of the parent of parcel ref "${shownValue(feature.ref)}" take its whole baseline length, so none is left to enhance`
    )
  }
  return shareKm
}

/**
 * The baseline length an Enhanced linear feature is priced against: its
 * parent's, when it is linked to one (a BNG Service template feature), else
 * the baseline feature's with its ref (a legacy feature). An Enhanced part of
 * a split BNG Service watercourse is priced against its share of what the
 * parent's Retained parts leave (withEnhancedWatercourseShares).
 *
 * @param {{ ref?: string | null, parentFeatureId?: string }} feature
 * @param {Map<string, number> | undefined} baselineLengthByRef
 *   buildBaselineLinearLengthByRef's result
 * @param {string} layerLabel
 * @returns {number}
 * @throws {BaselineLookupError}
 */
export function lookupBaselineLinearLength(
  feature,
  baselineLengthByRef,
  layerLabel
) {
  const { ref, parentFeatureId } = feature
  if (!baselineLengthByRef) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline data was provided (parcel ref "${shownValue(ref)}")`
    )
  }
  if (parentFeatureId) {
    const parentKm = baselineLengthByRef.byFeatureId?.get(parentFeatureId)
    if (parentKm == null) {
      throw new BaselineLookupError(
        `Cannot calculate Enhanced ${layerLabel} units: no baseline ${layerLabel} found for the parent of parcel ref "${shownValue(ref)}"`
      )
    }
    return shareOfParent(feature, parentKm, baselineLengthByRef, layerLabel)
  }
  const key = normaliseRef(ref)
  const lengthKm = key === null ? undefined : baselineLengthByRef.get(key)
  if (lengthKm == null) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline ${layerLabel} found for parcel ref "${shownValue(ref)}"`
    )
  }
  return lengthKm
}
