import * as turf from '@turf/turf'

import { ERROR_CODES, featureRef, makeError } from '../errors.js'
import { safeIntersect } from '../spatial.js'

const OVERLAP_AREA_TOLERANCE_SQ_METRES = 0.5

function overlapsMeaningfully(a, b) {
  const intersection = safeIntersect(a, b)
  if (!intersection) {
    return false
  }
  // Spherical area is fine here — we only need to know if it's > 0 m².
  return turf.area(intersection) > OVERLAP_AREA_TOLERANCE_SQ_METRES
}

export function parcelOverlaps(areaFeatures) {
  if (!areaFeatures || areaFeatures.length < 2) {
    return null
  }
  const offendingIndexes = new Set()
  for (let i = 0; i < areaFeatures.length; i++) {
    for (let j = i + 1; j < areaFeatures.length; j++) {
      if (overlapsMeaningfully(areaFeatures[i], areaFeatures[j])) {
        offendingIndexes.add(i)
        offendingIndexes.add(j)
      }
    }
  }
  if (offendingIndexes.size === 0) {
    return null
  }
  const offending = [...offendingIndexes]
    .sort((a, b) => a - b)
    .map((i) => featureRef(areaFeatures[i], i))
  return makeError(
    ERROR_CODES.PARCEL_OVERLAPS,
    'One or more area habitat parcels overlap with other parcels',
    offending
  )
}
