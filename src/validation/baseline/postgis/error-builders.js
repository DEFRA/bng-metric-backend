import { ERROR_CODES, makeError } from '../errors.js'

function redlineInvalidGeometryMessage(payload) {
  if (!payload?.reason) {
    return 'Redline boundary geometry is invalid'
  }
  if (!payload.location_wkt) {
    return `Redline boundary geometry is invalid: ${payload.reason}`
  }
  return `Redline boundary geometry is invalid: ${payload.reason} at ${payload.location_wkt}`
}

export const ERROR_BUILDERS = {
  [ERROR_CODES.NO_REDLINE]: () =>
    makeError(
      ERROR_CODES.NO_REDLINE,
      'Baseline file contains no redline boundary polygon'
    ),
  [ERROR_CODES.REDLINE_OUTSIDE_ENGLAND]: () =>
    makeError(
      ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
      'Redline boundary is outside England'
    ),
  [ERROR_CODES.REDLINE_AREA_TOO_LARGE]: (p) =>
    makeError(
      ERROR_CODES.REDLINE_AREA_TOO_LARGE,
      `Redline boundary area (${Number(p.total).toFixed(0)} sq m) exceeds the 100 sq km limit`
    ),
  [ERROR_CODES.NO_HABITAT_AREAS]: () =>
    makeError(
      ERROR_CODES.NO_HABITAT_AREAS,
      'Baseline file contains no area habitat polygons'
    ),
  [ERROR_CODES.REDLINE_INVALID_GEOMETRY]: (p) =>
    makeError(
      ERROR_CODES.REDLINE_INVALID_GEOMETRY,
      redlineInvalidGeometryMessage(p)
    ),
  [ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY]: () =>
    makeError(
      ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
      'One or more area habitat polygons have invalid geometry'
    ),
  [ERROR_CODES.PARCEL_OVERLAPS]: () =>
    makeError(
      ERROR_CODES.PARCEL_OVERLAPS,
      'One or more area habitat parcels overlap with other parcels'
    ),
  [ERROR_CODES.SLIVERS_INSIDE_REDLINE]: () =>
    makeError(
      ERROR_CODES.SLIVERS_INSIDE_REDLINE,
      'Baseline file contains slivers inside the redline boundary that are not covered by any area habitat polygon'
    ),
  [ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE]: () =>
    makeError(
      ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
      'One or more area habitat polygons are not entirely within the redline boundary'
    ),
  [ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE]: () =>
    makeError(
      ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
      'One or more hedgerow habitats are not entirely within the redline boundary'
    ),
  [ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE]: () =>
    makeError(
      ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
      'One or more watercourse habitats are not entirely within the redline boundary'
    ),
  [ERROR_CODES.IGGIS_OUTSIDE_REDLINE]: () =>
    makeError(
      ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
      'One or more IGGIs are not entirely within the redline boundary'
    ),
  [ERROR_CODES.TREES_OUTSIDE_REDLINE]: () =>
    makeError(
      ERROR_CODES.TREES_OUTSIDE_REDLINE,
      'One or more trees are not entirely within the redline boundary'
    ),
  [ERROR_CODES.AREA_SUM_MISMATCH]: (p) =>
    makeError(
      ERROR_CODES.AREA_SUM_MISMATCH,
      `Sum of area habitat polygons (${Number(p.habitats_total).toFixed(2)} sq m) does not equal redline boundary area (${Number(p.redline_total).toFixed(2)} sq m)`
    )
}
