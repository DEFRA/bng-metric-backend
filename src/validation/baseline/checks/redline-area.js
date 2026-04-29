import { ERROR_CODES, makeError } from '../errors.js'
import { planarArea } from '../spatial.js'

const MAX_AREA_SQ_METRES = 100 * 1000 * 1000 // 100 sq km

export function redlineArea(redlineFeatures) {
  if (!redlineFeatures || redlineFeatures.length === 0) {
    return null
  }
  const total = redlineFeatures.reduce(
    (acc, f) => acc + planarArea(f.nativeGeometry ?? f.geometry),
    0
  )
  if (total > MAX_AREA_SQ_METRES) {
    return makeError(
      ERROR_CODES.REDLINE_AREA_TOO_LARGE,
      `Redline boundary area (${total.toFixed(0)} sq m) exceeds the 100 sq km limit`
    )
  }
  return null
}
