export const ERROR_CODES = Object.freeze({
  GPKG_INVALID_FILE: 'GPKG_INVALID_FILE',
  GPKG_NOT_A_GEOPACKAGE: 'GPKG_NOT_A_GEOPACKAGE',
  GPKG_MISSING_SYSTEM_TABLE: 'GPKG_MISSING_SYSTEM_TABLE',
  GPKG_MISSING_LAYER: 'GPKG_MISSING_LAYER',
  GPKG_RLB_NO_GEOMETRY_COLUMN: 'GPKG_RLB_NO_GEOMETRY_COLUMN',
  GPKG_RLB_UNREADABLE_GEOMETRY: 'GPKG_RLB_UNREADABLE_GEOMETRY',
  GPKG_RLB_NO_POLYGON: 'GPKG_RLB_NO_POLYGON',
  GPKG_RLB_TOO_MANY_POLYGONS: 'GPKG_RLB_TOO_MANY_POLYGONS',
  GPKG_UNEXPECTED_FEATURE_LAYER: 'GPKG_UNEXPECTED_FEATURE_LAYER',
  GPKG_BASELINE_CONTENTS_DATA_TYPE: 'GPKG_BASELINE_CONTENTS_DATA_TYPE',
  GPKG_BASELINE_SRS_ID: 'GPKG_BASELINE_SRS_ID',
  GPKG_BASELINE_GPKG_SRS_INCONSISTENT: 'GPKG_BASELINE_GPKG_SRS_INCONSISTENT',
  GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME:
    'GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME',
  GPKG_BASELINE_MULTIPLE_GEOMETRY_COLUMNS:
    'GPKG_BASELINE_MULTIPLE_GEOMETRY_COLUMNS',
  GPKG_BASELINE_GEOMETRY_TYPE_NAME: 'GPKG_BASELINE_GEOMETRY_TYPE_NAME',
  GPKG_BASELINE_MISSING_COLUMN: 'GPKG_BASELINE_MISSING_COLUMN',
  GPKG_BASELINE_COLUMN_SQLITE_TYPE: 'GPKG_BASELINE_COLUMN_SQLITE_TYPE',
  GPKG_BASELINE_COLUMN_NOT_NULL: 'GPKG_BASELINE_COLUMN_NOT_NULL',
  GPKG_BASELINE_COLUMN_PRIMARY_KEY: 'GPKG_BASELINE_COLUMN_PRIMARY_KEY',
  GPKG_BASELINE_GEOMETRY_REGISTRATION_MISSING:
    'GPKG_BASELINE_GEOMETRY_REGISTRATION_MISSING',
  NO_REDLINE: 'NO_REDLINE',
  GPKG_HABITATS_NO_GEOMETRY_COLUMN: 'GPKG_HABITATS_NO_GEOMETRY_COLUMN',
  GPKG_HABITATS_UNREADABLE_GEOMETRY: 'GPKG_HABITATS_UNREADABLE_GEOMETRY',
  GPKG_HABITATS_WRONG_GEOMETRY_TYPE: 'GPKG_HABITATS_WRONG_GEOMETRY_TYPE',
  GPKG_HEDGEROWS_UNREADABLE_GEOMETRY: 'GPKG_HEDGEROWS_UNREADABLE_GEOMETRY',
  GPKG_HEDGEROWS_NO_LINESTRING_GEOMETRY:
    'GPKG_HEDGEROWS_NO_LINESTRING_GEOMETRY',
  GPKG_HEDGEROWS_WRONG_GEOMETRY_TYPE: 'GPKG_HEDGEROWS_WRONG_GEOMETRY_TYPE',
  GPKG_RIVERS_UNREADABLE_GEOMETRY: 'GPKG_RIVERS_UNREADABLE_GEOMETRY',
  GPKG_RIVERS_NO_LINESTRING_GEOMETRY: 'GPKG_RIVERS_NO_LINESTRING_GEOMETRY',
  GPKG_RIVERS_WRONG_GEOMETRY_TYPE: 'GPKG_RIVERS_WRONG_GEOMETRY_TYPE',
  REDLINE_OUTSIDE_ENGLAND: 'REDLINE_OUTSIDE_ENGLAND',
  REDLINE_AREA_TOO_LARGE: 'REDLINE_AREA_TOO_LARGE',
  NO_HABITAT_AREAS: 'NO_HABITAT_AREAS',
  REDLINE_INVALID_GEOMETRY: 'REDLINE_INVALID_GEOMETRY',
  AREA_PARCELS_INVALID_GEOMETRY: 'AREA_PARCELS_INVALID_GEOMETRY',
  PARCEL_OVERLAPS: 'PARCEL_OVERLAPS',
  AREA_PARCELS_TOO_SMALL: 'AREA_PARCELS_TOO_SMALL',
  SLIVERS_OUTSIDE_REDLINE: 'SLIVERS_OUTSIDE_REDLINE',
  AREA_PARCELS_OUTSIDE_REDLINE: 'AREA_PARCELS_OUTSIDE_REDLINE',
  HEDGEROWS_OUTSIDE_REDLINE: 'HEDGEROWS_OUTSIDE_REDLINE',
  WATERCOURSES_OUTSIDE_REDLINE: 'WATERCOURSES_OUTSIDE_REDLINE',
  IGGIS_OUTSIDE_REDLINE: 'IGGIS_OUTSIDE_REDLINE',
  TREES_OUTSIDE_REDLINE: 'TREES_OUTSIDE_REDLINE',
  AREA_SUM_MISMATCH: 'AREA_SUM_MISMATCH',
  HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE: 'HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE',
  DUPLICATE_HABITAT_REF: 'DUPLICATE_HABITAT_REF',

  /** A feature carries both advance and delay years; the statutory metric allows only one. */
  ADVANCE_AND_DELAY_BOTH_SET: 'ADVANCE_AND_DELAY_BOTH_SET',

  /** Habitat sizes were not measured during validation, so the document cannot be built. */
  SIZING_FAILED: 'SIZING_FAILED',

  /** Extracted document fails habitatDataSchema — e.g. a feature is missing its featureId or status. */
  INVALID_FILE_METADATA: 'INVALID_FILE_METADATA',

  /** The uploaded file's own name fails SAFE_FILENAME_RE or the length limit. The user fixes this by renaming the file, so it is reported apart from a malformed document. */
  INVALID_FILENAME: 'INVALID_FILENAME',

  /** Non-GeoPackage failure while running the baseline validation pipeline (e.g. unexpected exception). */
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  /**
   * Every geometry-validation worker was busy and the queue was full, so the
   * file was never looked at.
   *
   * Deliberately NOT a validation error: there is nothing wrong with the user's
   * file and nothing for them to fix. It is capacity, it is temporary, and the
   * only sensible instruction is to try again — which is why the route answers
   * it with a 503 and a Retry-After rather than the usual 200-with-errors.
   */
  VALIDATION_BUSY: 'VALIDATION_BUSY'
})

export function makeError(code, message, details) {
  return details === undefined ? { code, message } : { code, message, details }
}

/** Top-level key holding the uploaded file's own name, on both the metadata probe and the extracted document. */
const FILENAME_KEY = 'filename'
/** Joi `path[0]` is the document root; only that slot is the uploaded file's name. */
const PATH_ROOT_INDEX = 0

/**
 * Choose the error code for a Joi rejection of upload metadata or of the
 * extracted document. A rejected file name is the only one of these the user
 * can act on — they rename the file — so it is reported separately from a
 * document whose structure is wrong.
 *
 * @param {{message: string, details?: Array<{path?: Array<string|number>}>}} joiError
 * @returns {{code: string, message: string}}
 */
export function makeMetadataError(joiError) {
  const rejectedFilename = joiError?.details?.some(
    (detail) => detail?.path?.[PATH_ROOT_INDEX] === FILENAME_KEY
  )

  return makeError(
    rejectedFilename
      ? ERROR_CODES.INVALID_FILENAME
      : ERROR_CODES.INVALID_FILE_METADATA,
    joiError.message
  )
}
