import { BaselineLookupError } from 'bng-library/metric'

import { normaliseRef } from '../../../validation/geopackage/carry-forward-feature-ids.js'
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

/** The baseline layer an Enhanced feature's layer label names. */
const LAYER_BY_LABEL = Object.freeze({
  hedgerow: 'hedgerows',
  watercourse: 'watercourses'
})

/**
 * The measured lengths of a baseline's hedgerows and watercourses, in km.
 *
 * - `byRef` holds one Map<parcelRef, lengthKm> per layer, which a legacy
 *   upload's Enhanced feature is priced against by its own ref. A hedgerow and
 *   a watercourse may share a ref (BMD-1058, BMD-1180 AC7), so the layers are
 *   never pooled: one would be priced against the other's length.
 * - `byFeatureId` is what a feature linked to its baseline feature is priced
 *   against: a BNG Service template feature through its parent link
 *   (BMD-1083), or a legacy feature the re-derive resolved to one
 *   (`sourceFeatureIdByRow`). Several features in a layer may share a ref, so
 *   a feature whose baseline feature is known is never looked up by ref.
 * - `sourceFeatureIdByRow` maps a post-intervention row's featureId to the
 *   featureId of the baseline feature it was resolved to
 *   (resync-post-intervention-baseline.js).
 */
class BaselineLinearLengths {
  /** @type {Record<string, Map<string, number>>} */
  byRef = { hedgerows: new Map(), watercourses: new Map() }

  /** @type {Map<string, number>} */
  byFeatureId = new Map()

  /** @type {Map<string, string>} */
  sourceFeatureIdByRow

  constructor(sourceFeatureIdByRow = new Map()) {
    this.sourceFeatureIdByRow = sourceFeatureIdByRow
  }
}

function addLayerLengths(lengths, layer, features) {
  for (const feature of features) {
    if (typeof feature.sizeMetres !== 'number' || feature.sizeMetres <= 0) {
      continue
    }
    const lengthKm = linearLengthKmFromSizeMetres(feature.sizeMetres)
    const ref = normaliseRef(feature.ref)
    if (ref !== null) {
      lengths.byRef[layer].set(ref, lengthKm)
    }
    if (feature.featureId) {
      lengths.byFeatureId.set(feature.featureId, lengthKm)
    }
  }
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
 * @param {{ sourceFeatureIdByRow?: Map<string, string> }} [resolved]
 *   the baseline feature each post-intervention row was resolved to
 * @returns {BaselineLinearLengths}
 */
export function buildBaselineLinearLengthByRef(
  hedgerows = [],
  watercourses = [],
  { sourceFeatureIdByRow } = {}
) {
  const lengths = new BaselineLinearLengths(sourceFeatureIdByRow)
  addLayerLengths(lengths, 'hedgerows', hedgerows)
  addLayerLengths(lengths, 'watercourses', watercourses)
  return lengths
}

function lookupByFeatureId(lengths, featureId, layerLabel, owner) {
  const lengthKm = lengths.byFeatureId.get(featureId)
  if (lengthKm == null) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline ${layerLabel} found for ${owner}`
    )
  }
  return lengthKm
}

/**
 * The baseline length an Enhanced linear feature is priced against: its
 * parent's, when it is linked to one (a BNG Service template feature), else
 * the baseline feature the re-derive resolved it to, else the baseline
 * feature in its own layer with its ref (a legacy feature).
 *
 * @param {{ featureId?: string, ref?: string | null, parentFeatureId?: string }} feature
 * @param {BaselineLinearLengths | undefined} baselineLengthByRef
 *   buildBaselineLinearLengthByRef's result
 * @param {'hedgerow' | 'watercourse'} layerLabel
 * @returns {number}
 * @throws {BaselineLookupError}
 */
export function lookupBaselineLinearLength(
  feature,
  baselineLengthByRef,
  layerLabel
) {
  const { featureId, ref, parentFeatureId } = feature
  if (!baselineLengthByRef) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline data was provided (parcel ref "${shownValue(ref)}")`
    )
  }
  if (parentFeatureId) {
    return lookupByFeatureId(
      baselineLengthByRef,
      parentFeatureId,
      layerLabel,
      `the parent of parcel ref "${shownValue(ref)}"`
    )
  }
  const sourceFeatureId = featureId
    ? baselineLengthByRef.sourceFeatureIdByRow.get(featureId)
    : undefined
  if (sourceFeatureId) {
    return lookupByFeatureId(
      baselineLengthByRef,
      sourceFeatureId,
      layerLabel,
      `parcel ref "${shownValue(ref)}"`
    )
  }
  const key = normaliseRef(ref)
  const lengthKm =
    key === null
      ? undefined
      : baselineLengthByRef.byRef[LAYER_BY_LABEL[layerLabel]]?.get(key)
  if (lengthKm == null) {
    throw new BaselineLookupError(
      `Cannot calculate Enhanced ${layerLabel} units: no baseline ${layerLabel} found for parcel ref "${shownValue(ref)}"`
    )
  }
  return lengthKm
}
