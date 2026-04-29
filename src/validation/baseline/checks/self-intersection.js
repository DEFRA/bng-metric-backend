import * as turf from '@turf/turf'

import { ERROR_CODES, featureRef, makeError } from '../errors.js'

function isSelfIntersecting(feature) {
  // turf.kinks works on LineString, MultiLineString, Polygon, MultiPolygon —
  // Polygon coverage detects self-intersection of any ring.
  try {
    return turf.kinks(feature).features.length > 0
  } catch {
    // turf throws on unsupported types; treat as not self-intersecting so we
    // don't fail the whole validation on a degenerate input.
    return false
  }
}

export function redlineSelfIntersection(redlineFeatures) {
  if (!redlineFeatures || redlineFeatures.length === 0) {
    return null
  }
  for (const feature of redlineFeatures) {
    if (isSelfIntersecting(feature)) {
      return makeError(
        ERROR_CODES.REDLINE_SELF_INTERSECTING,
        'Redline boundary is self-intersecting'
      )
    }
  }
  return null
}

export function areaParcelsSelfIntersection(areaFeatures) {
  if (!areaFeatures || areaFeatures.length === 0) {
    return null
  }
  const offending = []
  areaFeatures.forEach((feature, index) => {
    if (isSelfIntersecting(feature)) {
      offending.push(featureRef(feature, index))
    }
  })
  if (offending.length === 0) {
    return null
  }
  return makeError(
    ERROR_CODES.AREA_PARCELS_SELF_INTERSECTING,
    'One or more area habitat polygons are self-intersecting',
    offending
  )
}
