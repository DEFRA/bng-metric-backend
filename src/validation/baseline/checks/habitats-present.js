import { ERROR_CODES, makeError } from '../errors.js'

// MERGE NOTE (PR #16): validateGpkg covers layer-presence; this stays useful
// only as a zero-features guard (decide on merge whether to keep).
export function habitatsPresent(areaFeatures) {
  if (!areaFeatures || areaFeatures.length === 0) {
    return makeError(
      ERROR_CODES.NO_HABITAT_AREAS,
      'Baseline file contains no area habitat polygons'
    )
  }
  return null
}
