import { ERROR_CODES, makeError } from '../errors.js'
import { planarArea } from '../spatial.js'

const DEFAULT_TOLERANCE_SQ_METRES = 0.5

export function areaSum(
  redlineFeatures,
  areaFeatures,
  tolerance = DEFAULT_TOLERANCE_SQ_METRES
) {
  if (!redlineFeatures || redlineFeatures.length === 0) {
    return null
  }
  if (!areaFeatures || areaFeatures.length === 0) {
    return null
  }

  const redlineTotal = redlineFeatures.reduce(
    (acc, f) => acc + planarArea(f.nativeGeometry ?? f.geometry),
    0
  )
  const habitatsTotal = areaFeatures.reduce(
    (acc, f) => acc + planarArea(f.nativeGeometry ?? f.geometry),
    0
  )

  if (Math.abs(redlineTotal - habitatsTotal) <= tolerance) {
    return null
  }

  return makeError(
    ERROR_CODES.AREA_SUM_MISMATCH,
    `Sum of area habitat polygons (${habitatsTotal.toFixed(2)} sq m) does not equal redline boundary area (${redlineTotal.toFixed(2)} sq m)`
  )
}
