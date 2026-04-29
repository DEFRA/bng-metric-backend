import * as turf from '@turf/turf'

import { ERROR_CODES, makeError } from '../errors.js'
import { safeDifference, unionFeatures } from '../spatial.js'

const DEFAULT_SLIVER_THRESHOLD_SQ_METRES = 1

/**
 * A sliver is a small leftover sliver of redline-bounded area that no parcel
 * covers. Compute the difference between the redline boundary and the union
 * of all area habitat parcels; any resulting polygon whose area is below the
 * threshold is reported.
 */
export function slivers(
  redlineFeatures,
  areaFeatures,
  threshold = DEFAULT_SLIVER_THRESHOLD_SQ_METRES
) {
  if (!redlineFeatures || redlineFeatures.length === 0) {
    return null
  }
  if (!areaFeatures || areaFeatures.length === 0) {
    return null
  }

  const redlineUnion = unionFeatures(redlineFeatures)
  const areaUnion = unionFeatures(areaFeatures)
  if (!redlineUnion || !areaUnion) {
    return null
  }

  const leftover = safeDifference(redlineUnion, areaUnion)
  if (!leftover) {
    return null
  }

  const polygons =
    leftover.geometry.type === 'Polygon'
      ? [leftover.geometry.coordinates]
      : leftover.geometry.coordinates

  const sliverPolys = []
  polygons.forEach((rings, index) => {
    const polyFeature = turf.polygon(rings)
    const area = turf.area(polyFeature)
    if (area < threshold) {
      sliverPolys.push({ id: index, area: Number(area.toFixed(4)) })
    }
  })

  if (sliverPolys.length === 0) {
    return null
  }

  return makeError(
    ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
    'Baseline file contains slivers between area habitat polygons and the redline boundary',
    sliverPolys
  )
}
