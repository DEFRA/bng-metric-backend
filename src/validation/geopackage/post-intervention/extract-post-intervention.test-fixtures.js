export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const BNG_SRID = 27700
export const PARCEL_REF = 'Parcel Ref'

export const HABITAT_SQM = 5000
export const HEDGEROW_M = 120
export const WATERCOURSE_M = 250
export const UPLOADED_FILE_SIZE = 204800

export const FEAT_ID_AREA = 'featarea-0000-0000-0000-000000000000'
export const FEAT_ID_HEDGE = 'featheg0-0000-0000-0000-000000000000'
export const FEAT_ID_WC = 'featwc00-0000-0000-0000-000000000000'

export const SAMPLE_POLYGON = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0]
    ]
  ]
}

export const SAMPLE_LINESTRING = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1]
  ]
}

export function feature(
  properties,
  geometry = SAMPLE_POLYGON,
  srid = BNG_SRID
) {
  return {
    type: 'Feature',
    properties,
    nativeGeometry: geometry,
    nativeSrid: srid
  }
}
