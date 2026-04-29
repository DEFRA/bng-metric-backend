import * as turf from '@turf/turf'

import { ERROR_CODES, featureRef, makeError } from '../errors.js'
import { unionFeatures } from '../spatial.js'

function isWithin(feature, redline) {
  try {
    return turf.booleanWithin(feature, redline)
  } catch {
    return false
  }
}

const SPECS = {
  areas: {
    code: ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
    message:
      'One or more area habitat polygons are not entirely within the redline boundary'
  },
  hedgerows: {
    code: ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
    message:
      'One or more hedgerow habitats are not entirely within the redline boundary'
  },
  watercourses: {
    code: ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
    message:
      'One or more watercourse habitats are not entirely within the redline boundary'
  },
  iggis: {
    code: ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
    message: 'One or more IGGIs are not entirely within the redline boundary'
  },
  trees: {
    code: ERROR_CODES.TREES_OUTSIDE_REDLINE,
    message: 'One or more trees are not entirely within the redline boundary'
  }
}

export function withinRedline(layerName, features, redlineFeatures) {
  const spec = SPECS[layerName]
  if (!spec) {
    throw new Error(`Unknown layer: ${layerName}`)
  }
  if (!features || features.length === 0) {
    return null
  }
  const redline = unionFeatures(redlineFeatures)
  if (!redline) {
    return null
  }

  const offending = []
  features.forEach((feature, index) => {
    if (!isWithin(feature, redline)) {
      offending.push(featureRef(feature, index))
    }
  })
  if (offending.length === 0) {
    return null
  }
  return makeError(spec.code, spec.message, offending)
}
