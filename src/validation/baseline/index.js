import { readBaselineGeoPackage } from './geopackage.js'
import { redlineInEngland } from './checks/redline-in-england.js'
import { redlineArea } from './checks/redline-area.js'
import { habitatsPresent } from './checks/habitats-present.js'
import {
  redlineSelfIntersection,
  areaParcelsSelfIntersection
} from './checks/self-intersection.js'
import { parcelOverlaps } from './checks/parcel-overlaps.js'
import { slivers } from './checks/slivers.js'
import { withinRedline } from './checks/within-redline.js'
import { areaSum } from './checks/area-sum.js'

// MERGE NOTE (PR #16): the geometry checks below assume validateGpkg already
// ran and passed — caller must run that format gate first.

/**
 * Run every geometry check against an open baseline GeoPackage file.
 * Returns `{ valid, errors }`.
 *
 * @param {string} filePath
 */
export function validateBaselineFile(filePath) {
  const layers = readBaselineGeoPackage(filePath)
  return validateBaselineLayers(layers)
}

/**
 * Same as validateBaselineFile, but takes already-parsed layers. Useful for
 * tests where building a real .gpkg fixture is heavyweight.
 */
export function validateBaselineLayers(layers) {
  const errors = []

  const push = (err) => {
    if (err) {
      errors.push(err)
    }
  }

  push(redlineInEngland(layers.redline))
  push(redlineArea(layers.redline))
  push(habitatsPresent(layers.areas))
  push(redlineSelfIntersection(layers.redline))
  push(areaParcelsSelfIntersection(layers.areas))
  push(parcelOverlaps(layers.areas))
  push(slivers(layers.redline, layers.areas))
  push(withinRedline('areas', layers.areas, layers.redline))
  push(withinRedline('hedgerows', layers.hedgerows, layers.redline))
  push(withinRedline('watercourses', layers.watercourses, layers.redline))
  push(withinRedline('iggis', layers.iggis, layers.redline))
  push(withinRedline('trees', layers.trees, layers.redline))
  push(areaSum(layers.redline, layers.areas))

  return { valid: errors.length === 0, errors }
}
