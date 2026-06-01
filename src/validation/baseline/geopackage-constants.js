/**
 * GeoPackage application IDs per OGC — GP10 covers v1.0; GPKG covers v1.2.1+.
 */
export const GPKG_APP_ID_GP10 = 0x47503130
export const GPKG_APP_ID_GPKG = 0x47504b47

export const GPKG_APPLICATION_IDS = new Set([
  GPKG_APP_ID_GP10,
  GPKG_APP_ID_GPKG
])

/** EPSG:4326 */
export const EPSG_WGS84 = 4326
/** EPSG:27700 — British National Grid */
export const EPSG_BNG = 27700
/** EPSG:3857 — Web Mercator (negative tests only) */
export const EPSG_WEB_MERCATOR = 3857

/** Magic bytes prefix of GeoPackageBinary ('G', 'P'). OGC GeoPackage 1.2 §2.1.3 */
export const GPKG_MAGIC_BYTE_G = 0x47
export const GPKG_MAGIC_BYTE_P = 0x50

/** Header size before optional envelope / WKB: magic + version + flags + srs_id */
export const GPKG_HEADER_BYTES = 8

/** Byte offset of the flags octet within the GeoPackageBinary header */
export const GPKG_FLAGS_BYTE_INDEX = 3

/** Low 3 bits of (flags >> 1): envelope indicator */
export const GPKG_ENVELOPE_INDICATOR_MASK = 0x07

/** After header + envelope: endian marker + geometry type integer */
export const WKB_MIN_BYTES = 5

/** Envelope sizes by indicator — OGC gpb_format */
export const GPKG_ENVELOPE_XY_BYTES = 32
export const GPKG_ENVELOPE_XYZ_BYTES = 48
export const GPKG_ENVELOPE_XYZM_BYTES = 64

export const GPKG_ENVELOPE_SIZES = [
  0,
  GPKG_ENVELOPE_XY_BYTES,
  GPKG_ENVELOPE_XYZ_BYTES,
  GPKG_ENVELOPE_XYZ_BYTES,
  GPKG_ENVELOPE_XYZM_BYTES
]

/**
 * WKB geometry type codes (OGC SF; Z/M/ZM variants).
 * https://www.geopackage.org/spec/#geometry_types
 */
export const WKB_POLYGON = 3
export const WKB_MULTI_POLYGON = 6
export const WKB_POLYGON_Z = 1003
export const WKB_MULTI_POLYGON_Z = 1006
export const WKB_POLYGON_M = 2003
export const WKB_MULTI_POLYGON_M = 2006
export const WKB_POLYGON_ZM = 3003
export const WKB_MULTI_POLYGON_ZM = 3006

export const WKB_LINE_STRING = 2
export const WKB_MULTI_LINE_STRING = 5
export const WKB_LINE_STRING_Z = 1002
export const WKB_MULTI_LINE_STRING_Z = 1005
export const WKB_LINE_STRING_M = 2002
export const WKB_MULTI_LINE_STRING_M = 2005
export const WKB_LINE_STRING_ZM = 3002
export const WKB_MULTI_LINE_STRING_ZM = 3005
export const WKB_POINT = 1

export const POLYGON_WKB_TYPES = new Set([
  WKB_POLYGON,
  WKB_MULTI_POLYGON,
  WKB_POLYGON_Z,
  WKB_MULTI_POLYGON_Z,
  WKB_POLYGON_M,
  WKB_MULTI_POLYGON_M,
  WKB_POLYGON_ZM,
  WKB_MULTI_POLYGON_ZM
])

/** Lower-case `gpkg_contents.table_name` key for the Red Line Boundary layer */
export const RLB_LYR = 'red line boundary'

/** Lower-case `gpkg_contents.table_name` key for the Habitats layer */
export const HABITATS_LYR = 'habitats'

/** Lower-case `gpkg_contents.table_name` key for the Hedgerows layer */
export const HEDGEROWS_LYR = 'hedgerows'

/** Lower-case `gpkg_contents.table_name` key for the Rivers (watercourses) layer */
export const RIVERS_LYR = 'rivers'

/** Lower-case string stored in `gpkg_contents.data_type` for spatial feature layers. */
export const GPKG_CONTENTS_FEATURES_DATA_TYPE = 'features'

/** Red Line Boundary: expected polygon count (baseline metric rule). */
export const RL_BOUNDARY_EXPECTED_POLYGON_COUNT = 1

/** Habitats: minimum polygon / multi-polygon count required. */
export const HABITATS_EXPECTED_MIN_POLYGON_COUNT = 1

/** Optional linear layers: minimum linestring count when the layer has rows. */
export const LINEAR_LAYER_EXPECTED_MIN_LINESTRING_COUNT = 1

export const LINESTRING_WKB_TYPES = new Set([
  WKB_LINE_STRING,
  WKB_MULTI_LINE_STRING,
  WKB_LINE_STRING_Z,
  WKB_MULTI_LINE_STRING_Z,
  WKB_LINE_STRING_M,
  WKB_MULTI_LINE_STRING_M,
  WKB_LINE_STRING_ZM,
  WKB_MULTI_LINE_STRING_ZM
])
