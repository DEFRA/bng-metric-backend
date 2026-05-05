import { ERROR_CODES, featureRef, makeError } from '../errors.js'

const offendingFromPayload = (payload) =>
  (payload?.offending ?? []).map((o) =>
    featureRef({ properties: o.props ?? {} }, o.idx)
  )

function redlineInvalidGeometryMessage(payload) {
  const base = 'Redline boundary geometry is invalid'
  if (!payload?.reason) {
    return base
  }
  if (!payload.location_wkt) {
    return base + ': ' + payload.reason
  }
  return base + ': ' + payload.reason + ' at ' + payload.location_wkt
}

export const ERROR_BUILDERS = {
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
  [ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY]: (p) =>
    makeError(
      ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
      'One or more area habitat polygons have invalid geometry',
      (p?.offending ?? []).map((o) => ({
        ...featureRef({ properties: o.props ?? {} }, o.idx),
        reason: o.reason ?? null,
        location: o.location_wkt ?? null
      }))
    ),
  [ERROR_CODES.PARCEL_OVERLAPS]: (p) =>
    makeError(
      ERROR_CODES.PARCEL_OVERLAPS,
      'One or more area habitat parcels overlap with other parcels',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.SLIVERS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
      'Baseline file contains slivers between area habitat polygons and the redline boundary',
      (p?.slivers ?? []).map((s) => ({
        id: Number(s.id),
        area: Number(Number(s.area).toFixed(4))
      }))
    ),
  [ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
      'One or more area habitat polygons are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
      'One or more hedgerow habitats are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
      'One or more watercourse habitats are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.IGGIS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
      'One or more IGGIs are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.TREES_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.TREES_OUTSIDE_REDLINE,
      'One or more trees are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.AREA_SUM_MISMATCH]: (p) =>
    makeError(
      ERROR_CODES.AREA_SUM_MISMATCH,
      `Sum of area habitat polygons (${Number(p.habitats_total).toFixed(2)} sq m) does not equal redline boundary area (${Number(p.redline_total).toFixed(2)} sq m)`
    )
}
