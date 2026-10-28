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
  /**
   * More features than the synchronous validation pipeline can finish inside
   * its timeout ladder. Sized by VALIDATION_MAX_FEATURE_COUNT.
   */
  GPKG_TOO_MANY_FEATURES: 'GPKG_TOO_MANY_FEATURES',

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

  /** One or more area, hedgerow or watercourse habitats have no Parcel Ref, or only spaces (BMD-1058). One error for them all. */
  HABITAT_REF_MISSING: 'HABITAT_REF_MISSING',

  /** One or more Parcel Refs hold characters that are not valid UTF-8 (BMD-1058). One error for them all. */
  HABITAT_REF_INVALID_CHARACTERS: 'HABITAT_REF_INVALID_CHARACTERS',

  /**
   * An edit would rename a habitat to a reference another baseline habitat in
   * the same layer already carries (hedgerows and watercourses count as one
   * layer). The reference joins each post-intervention row to its baseline
   * parcel, so the rename would merge two parcels' rows. Imports may still
   * repeat a reference (BMD-1058).
   */
  HABITAT_REF_IN_USE: 'HABITAT_REF_IN_USE',

  /** An edit would leave an enhanced habitat that is not a valid enhancement of its baseline. */
  ENHANCEMENT_NOT_VALID: 'ENHANCEMENT_NOT_VALID',

  /**
   * One or more Enhanced rows enhance a baseline habitat the service cannot
   * enhance at all, such as a Medium habitat in Good condition (BMD-1182). The
   * file is refused rather than the enhancement nulled. One error for them
   * all; `details.sample` lists each row's layer, Habitat Ref, baseline
   * habitat, condition and distinctiveness, and the rule it breaks. The
   * frontend sends the user to the drop-out page.
   */
  BASELINE_NOT_ENHANCEABLE: 'BASELINE_NOT_ENHANCEABLE',

  /**
   * A tree point's "Count" is filled in but is not a whole number of trees
   * (1 or more). The template declares the column an integer, so there is no
   * right way to price 2.5 trees; the user corrects the file instead.
   */
  TREE_COUNT_NOT_WHOLE: 'TREE_COUNT_NOT_WHOLE',

  /** Habitat sizes were not measured during validation, so the document cannot be built. */
  SIZING_FAILED: 'SIZING_FAILED',

  /**
   * The baseline derived from a post-intervention file has no area habitats.
   * Persisting it would replace the stored baseline, including any feature
   * edits, with an empty one. A file whose Baseline columns are blank or
   * placeholders does this. For a BNG Service template file, whose baseline
   * is read from its own tables, the message names the empty Area Habitats
   * Baseline table instead; the code is the same, as the frontend's answer is.
   */
  NO_DERIVED_BASELINE_HABITATS: 'NO_DERIVED_BASELINE_HABITATS',

  /**
   * A Retained or Enhanced row has no Baseline type. That habitat belongs in
   * the derived baseline; dropping it would understate the baseline and
   * overstate the net change, so the upload is rejected.
   */
  BASELINE_TYPE_MISSING: 'BASELINE_TYPE_MISSING',

  /**
   * The file has no BNG Service template version record, and is not a legacy
   * file either, so there is nothing to say which template it is.
   */
  TEMPLATE_VERSION_MISSING: 'TEMPLATE_VERSION_MISSING',

  /** The file has more than one template version record, so its version is ambiguous. */
  TEMPLATE_VERSION_DUPLICATED: 'TEMPLATE_VERSION_DUPLICATED',

  /**
   * The file's template version record cannot be read: it is not referenced to
   * the whole GeoPackage, is not JSON, or does not name the bng-service format
   * and a version.
   */
  TEMPLATE_VERSION_INVALID: 'TEMPLATE_VERSION_INVALID',

  /** The file's template version is not one the service reads. `details.version` names it. */
  TEMPLATE_VERSION_UNSUPPORTED: 'TEMPLATE_VERSION_UNSUPPORTED',

  /**
   * A legacy (Natural England) template file, uploaded while the service takes
   * the BNG Service template. The user converts it with the QGIS plugin.
   */
  LEGACY_TEMPLATE_NOT_ACCEPTED: 'LEGACY_TEMPLATE_NOT_ACCEPTED',

  /**
   * A BNG Service template file uploaded at the baseline + post-intervention
   * endpoint whose Post-Intervention tables are all empty, so it has no
   * post-intervention stage to save. `details.template` names the template and
   * version. The frontend sends the user to the drop-out page.
   */
  POST_INTERVENTION_TABLES_EMPTY: 'POST_INTERVENTION_TABLES_EMPTY',

  /**
   * BNG Service template Retained or Enhanced rows with no `parent_uuid`, so
   * the baseline habitat they continue is not known (BMD-1083). The service
   * does not infer it: the user links the row in the template. `details.sample`
   * lists each row's table, Habitat Ref and habitat type. The frontend sends
   * the user to the drop-out page.
   */
  STAGED_PARENT_LINK_MISSING: 'STAGED_PARENT_LINK_MISSING',

  /**
   * BNG Service template rows whose `parent_uuid` names no baseline feature of
   * their layer, so their parent is missing (BMD-1083). `details.sample` lists
   * each row's table, Habitat Ref and habitat type. The frontend sends the user
   * to the drop-out page.
   */
  STAGED_UNKNOWN_PARENT_REF: 'STAGED_UNKNOWN_PARENT_REF',

  /**
   * BNG Service template rows whose `parent_uuid` names a `feature_uuid` that
   * more than one baseline feature of their layer has (a pasted copy can), so
   * which one each row continues is not known (BMD-1083). `details.sample`
   * lists each uuid's baseline table and Habitat Refs, and the Habitat Ref of
   * each row that names it. The frontend sends the user to the drop-out page.
   */
  STAGED_AMBIGUOUS_PARENT: 'STAGED_AMBIGUOUS_PARENT',

  /**
   * BNG Service template baseline features whose shape is not the one their
   * linked post-intervention rows recorded in `parent_geom`: the baseline was
   * edited after the copy, or a row's `parent_geom` is missing or cannot be
   * read, so the link cannot be checked (BMD-1083). `details.sample` lists
   * each parent's table, Habitat Ref and habitat type, and the Habitat Ref of
   * each affected post-intervention row. The frontend sends the user to the
   * drop-out page.
   */
  STAGED_BASELINE_DRIFTED: 'STAGED_BASELINE_DRIFTED',

  /**
   * BNG Service template baseline hedgerows shorter than the post-intervention
   * hedgerows linked to them together, Created ones included (BMD-1083).
   * `details.sample` lists each parent's table, Habitat Ref and hedge type, the
   * Habitat Ref of each linked row, and both lengths in metres. The frontend
   * sends the user to the drop-out page.
   */
  STAGED_HEDGEROW_CHILDREN_TOO_LONG: 'STAGED_HEDGEROW_CHILDREN_TOO_LONG',

  /**
   * BNG Service template baseline watercourses with both a Retained or Enhanced
   * post-intervention part and a Created part (BMD-1083): the service cannot
   * split a watercourse's length between continuation and loss.
   * `details.sample` lists each parent's table, Habitat Ref and River Type, and
   * the Habitat Ref of each part. The drop-out page tells the user to draw the
   * baseline watercourse as two features, one for each part.
   */
  STAGED_WATERCOURSE_RETAINED_AND_CREATED:
    'STAGED_WATERCOURSE_RETAINED_AND_CREATED',

  /**
   * BNG Service template baseline watercourses that are not a canal or a ditch
   * and have no post-intervention habitat (BMD-1083): the Metric guide lets
   * only a canal or a ditch be permanently lost. `details.sample` lists each
   * one's table, Habitat Ref and River Type. The drop-out page tells the user
   * to record each as Retained, Enhanced or Created.
   */
  STAGED_NATURAL_WATERCOURSE_LOST: 'STAGED_NATURAL_WATERCOURSE_LOST',

  /**
   * BNG Service template area habitats or hedgerows Created in their parent's
   * habitat type, linked to it, but not in a lower condition and with no delay
   * (BMD-1083): the habitat was kept. A row with a delay is a habitat lost for
   * a time and put back, which no degrade rule refuses. `details.sample` lists
   * each row's table, Habitat Ref and habitat type, and its parent's Habitat
   * Ref. The drop-out page says a habitat that is kept should be Retained or
   * Enhanced, and one put back should give its delay.
   */
  STAGED_DEGRADE_NOT_WORSE: 'STAGED_DEGRADE_NOT_WORSE',

  /**
   * BNG Service template area habitats or hedgerows Created in their parent's
   * habitat type, linked to it, with no delay, whose "Habitat created in
   * advance/years" is not 30+ (BMD-1083). The Metric guide asks for 30+ years for a habitat recorded
   * as lost and created again in a lower condition. `details.sample` lists each
   * row as STAGED_DEGRADE_NOT_WORSE does.
   */
  STAGED_DEGRADE_ADVANCE_NOT_30_PLUS: 'STAGED_DEGRADE_ADVANCE_NOT_30_PLUS',

  /**
   * BNG Service template watercourses Created in their parent's River Type,
   * linked to it, with no lower condition, more encroachment or shorter length,
   * and no delay (BMD-1083): there was no intervention. `details.sample` lists
   * each row as STAGED_DEGRADE_NOT_WORSE does. The drop-out page says a
   * watercourse with no intervention should be Retained, and one put back
   * should give its delay.
   */
  STAGED_WATERCOURSE_NO_INTERVENTION: 'STAGED_WATERCOURSE_NO_INTERVENTION',

  /** Extracted document fails habitatDataSchema — e.g. a feature is missing its featureId or status. */
  INVALID_FILE_METADATA: 'INVALID_FILE_METADATA',

  /** The uploaded file's own name fails SAFE_FILENAME_RE. The user fixes this by renaming the file, so it is reported apart from a malformed document. */
  INVALID_FILENAME: 'INVALID_FILENAME',

  /** The uploaded file's own name is longer than MAX_FILENAME_LENGTH. */
  FILENAME_TOO_LONG: 'FILENAME_TOO_LONG',

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
  VALIDATION_BUSY: 'VALIDATION_BUSY',

  /**
   * Geometry validation is permanently down on this instance — its workers
   * cannot start, and the pool has given up replacing them.
   *
   * Kept apart from VALIDATION_BUSY on purpose: busy is temporary and answered
   * with "come back", and the frontend re-polls on exactly that code. This one
   * must do the opposite — a retry meets the same wall — so the route answers
   * 503 WITHOUT a Retry-After and with this code, which drops the caller out
   * of the polling loop and onto an honest error page.
   */
  VALIDATION_UNAVAILABLE: 'VALIDATION_UNAVAILABLE'
})

export function makeError(code, message, details) {
  return details === undefined ? { code, message } : { code, message, details }
}

/** Top-level key holding the uploaded file's own name, on both the metadata probe and the extracted document. */
const FILENAME_KEY = 'filename'
/** Joi `path[0]` is the document root; only that slot is the uploaded file's name. */
const PATH_ROOT_INDEX = 0
/** Joi reports `.max()` failures with this `details[].type`. */
const JOI_STRING_MAX = 'string.max'

/**
 * Choose the error code for a Joi rejection of upload metadata or of the
 * extracted document. A rejected file name is the only one of these the user
 * can act on — they rename the file — so it is reported separately from a
 * document whose structure is wrong. Length and character-set failures are
 * separate codes because they need different messages on the upload page.
 *
 * @param {{message: string, details?: Array<{path?: Array<string|number>, type?: string}>}} joiError
 * @returns {{code: string, message: string}}
 */
export function makeMetadataError(joiError) {
  const details = joiError?.details
  const filenameTooLong = details?.some(
    (detail) =>
      detail?.path?.[PATH_ROOT_INDEX] === FILENAME_KEY &&
      detail?.type === JOI_STRING_MAX
  )
  const rejectedFilename = details?.some(
    (detail) => detail?.path?.[PATH_ROOT_INDEX] === FILENAME_KEY
  )

  let code
  if (filenameTooLong) {
    code = ERROR_CODES.FILENAME_TOO_LONG
  } else if (rejectedFilename) {
    code = ERROR_CODES.INVALID_FILENAME
  } else {
    code = ERROR_CODES.INVALID_FILE_METADATA
  }

  return makeError(code, joiError.message)
}
