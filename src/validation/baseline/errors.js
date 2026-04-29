export const ERROR_CODES = {
  REDLINE_OUTSIDE_ENGLAND: 'REDLINE_OUTSIDE_ENGLAND',
  REDLINE_AREA_TOO_LARGE: 'REDLINE_AREA_TOO_LARGE',
  NO_HABITAT_AREAS: 'NO_HABITAT_AREAS',
  REDLINE_SELF_INTERSECTING: 'REDLINE_SELF_INTERSECTING',
  AREA_PARCELS_SELF_INTERSECTING: 'AREA_PARCELS_SELF_INTERSECTING',
  PARCEL_OVERLAPS: 'PARCEL_OVERLAPS',
  SLIVERS_OUTSIDE_REDLINE: 'SLIVERS_OUTSIDE_REDLINE',
  AREA_PARCELS_OUTSIDE_REDLINE: 'AREA_PARCELS_OUTSIDE_REDLINE',
  HEDGEROWS_OUTSIDE_REDLINE: 'HEDGEROWS_OUTSIDE_REDLINE',
  WATERCOURSES_OUTSIDE_REDLINE: 'WATERCOURSES_OUTSIDE_REDLINE',
  IGGIS_OUTSIDE_REDLINE: 'IGGIS_OUTSIDE_REDLINE',
  TREES_OUTSIDE_REDLINE: 'TREES_OUTSIDE_REDLINE',
  AREA_SUM_MISMATCH: 'AREA_SUM_MISMATCH'
}

export function makeError(code, message, offendingFeatures = []) {
  return { code, message, offendingFeatures }
}

/**
 * Build a stable identifier for a feature so the dropout page can list which
 * polygons failed. Prefers `fid`, then a `name`-like property, else falls
 * back to the array index.
 */
export function featureRef(feature, index) {
  const props = feature.properties ?? {}
  const id = props.fid ?? props.id ?? props.OBJECTID ?? index
  const name = props.name ?? props.Name ?? props.NAME ?? null
  return name ? { id, name } : { id }
}
