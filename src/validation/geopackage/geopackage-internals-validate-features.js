import { ERROR_CODES, makeError } from './errors.js'
import {
  POLYGON_WKB_TYPES,
  LINESTRING_WKB_TYPES,
  RLB_LYR,
  HABITATS_LYR,
  HEDGEROWS_LYR,
  RIVERS_LYR,
  RL_BOUNDARY_EXPECTED_POLYGON_COUNT,
  HABITATS_EXPECTED_MIN_POLYGON_COUNT,
  LINEAR_LAYER_EXPECTED_MIN_LINESTRING_COUNT
} from './geopackage-constants.js'
import { caughtValueMessage } from './geopackage-internals-sqlite.js'

/**
 * Feature-count and geometry-type checks of the GeoPackage format gate.
 *
 * These read no rows of their own: they work from the geometry types the
 * single reader pass already classified (see read-feature-tables.js), so each
 * shape is pulled out of the file once (BMD-910).
 */

/** Comparator baseline for “more than zero countable items” checks. */
const INTEGER_COUNT_NONE = 0

const LOG_VALIDATE_PREFIX = 'validateGpkg: '

/** @type {{ warn: (msg: string) => void }} */
const NO_OP_LOGGER = { warn: () => {} }

/**
 * True when the reader could not scan the layer's geometries at all — the
 * physical table or the registered geometry column is unreadable.
 * @param {import('./read-feature-tables.js').FeatureTable} table
 */
function geometryScanFailed(table) {
  return table.geometryTypes === null
}

/**
 * @param {Array<number|null>} geometryTypes
 */
function countUnreadableGeometries(geometryTypes) {
  return geometryTypes.filter((wkbType) => wkbType === null).length
}

/**
 * @param {Array<number|null>} geometryTypes
 */
function countPolygonGeometries(geometryTypes) {
  return geometryTypes.filter((wkbType) => POLYGON_WKB_TYPES.has(wkbType))
    .length
}

/**
 * @param {Array<number|null>} geometryTypes
 */
function countLinestringGeometries(geometryTypes) {
  return geometryTypes.filter((wkbType) => LINESTRING_WKB_TYPES.has(wkbType))
    .length
}

/**
 * @param {number} polygonCount
 * @param {string[]} errors
 */
function pushRlPolygonCountErrors(polygonCount, errors) {
  if (polygonCount === INTEGER_COUNT_NONE) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_RLB_NO_POLYGON,
        'Zero red line boundaries in GeoPackage (expecting one)'
      )
    )
  } else if (polygonCount > RL_BOUNDARY_EXPECTED_POLYGON_COUNT) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_RLB_TOO_MANY_POLYGONS,
        'Too many red line boundaries in GeoPackage (expecting one)'
      )
    )
  } else {
    // exactly RL_BOUNDARY_EXPECTED_POLYGON_COUNT polygons — valid, no error
  }
}

/**
 * Validates that the Red Line Boundary layer contains exactly one polygon feature.
 * Geometry registration mismatches should already appear from compareGpkgToBaselineSchema.
 *
 * @param {Map<string, import('./read-feature-tables.js').FeatureTable>} featureTables
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateRedLineBoundary(
  featureTables,
  errors,
  logger = NO_OP_LOGGER
) {
  const table = featureTables.get(RLB_LYR)
  if (!table) {
    return
  }

  if (!table.hasGeometryRegistration) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_RLB_NO_GEOMETRY_COLUMN,
        'Red Line Boundary layer has no registered geometry column in gpkg_geometry_columns'
      )
    )
    return
  }
  if (!table.geometryColumnSafe) {
    // compareGeometryRegistrationRow (step 4) pushes GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME
    // when the name is not a safe SQLite identifier — do not run polygon counts.
    return
  }
  if (geometryScanFailed(table)) {
    logger.warn(
      `${LOG_VALIDATE_PREFIX}Red Line Boundary polygon count skipped: ${caughtValueMessage(table.selectFailure)}`
    )
    return
  }

  const unreadableCount = countUnreadableGeometries(table.geometryTypes)
  if (unreadableCount > INTEGER_COUNT_NONE) {
    logger.warn(
      `${LOG_VALIDATE_PREFIX}${unreadableCount} unreadable geometry blob(s) in Red Line Boundary (table: ${table.tableName})`
    )
    errors.push(
      makeError(
        ERROR_CODES.GPKG_RLB_UNREADABLE_GEOMETRY,
        'Red Line Boundary contains unreadable geometry'
      )
    )
    return
  }

  pushRlPolygonCountErrors(countPolygonGeometries(table.geometryTypes), errors)
}

/**
 * When a layer has readable geometry rows, every row must match the expected
 * WKB type and at least {@link minExpectedCount} rows must do so.
 *
 * @param {object} params
 * @param {number} params.geometryCount
 * @param {number} params.matchingCount
 * @param {number} params.minExpectedCount
 * @param {string} params.insufficientErrorCode
 * @param {string} params.insufficientMessage
 * @param {string} params.wrongTypeErrorCode
 * @param {string} params.wrongTypeMessage
 * @param {string[]} params.errors
 */
function pushExpectedGeometryTypeErrors({
  geometryCount,
  matchingCount,
  minExpectedCount,
  insufficientErrorCode,
  insufficientMessage,
  wrongTypeErrorCode,
  wrongTypeMessage,
  errors
}) {
  if (matchingCount < minExpectedCount) {
    errors.push(makeError(insufficientErrorCode, insufficientMessage))
    return
  }
  if (matchingCount < geometryCount) {
    errors.push(makeError(wrongTypeErrorCode, wrongTypeMessage))
  }
}

/**
 * Habitats must include at least one readable polygon/multipolygon feature,
 * and every non-null geometry row must be a polygon or multipolygon.
 *
 * @param {Map<string, import('./read-feature-tables.js').FeatureTable>} featureTables
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateHabitats(featureTables, errors, logger = NO_OP_LOGGER) {
  const table = featureTables.get(HABITATS_LYR)
  if (!table?.hasGeometryRegistration || !table.geometryColumnSafe) {
    return
  }
  if (geometryScanFailed(table)) {
    logger.warn(
      `${LOG_VALIDATE_PREFIX}Habitats parcel check skipped: ${caughtValueMessage(table.selectFailure)}`
    )
    return
  }

  const unreadableCount = countUnreadableGeometries(table.geometryTypes)
  if (unreadableCount > INTEGER_COUNT_NONE) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_HABITATS_UNREADABLE_GEOMETRY,
        'Habitats contains unreadable geometry'
      )
    )
    return
  }

  pushExpectedGeometryTypeErrors({
    geometryCount: table.geometryTypes.length,
    matchingCount: countPolygonGeometries(table.geometryTypes),
    minExpectedCount: HABITATS_EXPECTED_MIN_POLYGON_COUNT,
    insufficientErrorCode: ERROR_CODES.NO_HABITAT_AREAS,
    insufficientMessage:
      'Zero area habitat parcels in GeoPackage (expecting at least one)',
    wrongTypeErrorCode: ERROR_CODES.GPKG_HABITATS_WRONG_GEOMETRY_TYPE,
    wrongTypeMessage: 'Habitats contains feature(s) with non-polygon geometry',
    errors
  })
}

/**
 * Validate a linear (line-string) feature layer that is optional in the
 * GeoPackage. Skips silently when the layer has zero rows — an empty optional
 * layer is not an error. When the layer has rows, every non-null geometry row
 * must be a linestring and at least one linestring is required.
 *
 * @param {Map<string, import('./read-feature-tables.js').FeatureTable>} featureTables
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} logger
 * @param {object} layerConfig
 * @param {string} layerConfig.layerLowerKey lower(table_name) used in gpkg_contents
 * @param {string} layerConfig.unreadableErrorCode ERROR_CODES key for unreadable geometry
 * @param {string} layerConfig.noLinestringErrorCode ERROR_CODES key when no linestrings
 * @param {string} layerConfig.wrongTypeErrorCode ERROR_CODES key for mixed geometry types
 * @param {string} layerConfig.layerLabel human-readable name for log messages
 */
function validateOptionalLinearLayer(
  featureTables,
  errors,
  logger,
  layerConfig
) {
  const {
    layerLowerKey,
    unreadableErrorCode,
    noLinestringErrorCode,
    wrongTypeErrorCode,
    layerLabel
  } = layerConfig
  const table = featureTables.get(layerLowerKey)
  if (!table || table.rowCount === INTEGER_COUNT_NONE) {
    return
  }
  if (!table.hasGeometryRegistration || !table.geometryColumnSafe) {
    return
  }
  if (geometryScanFailed(table)) {
    logger.warn(
      `${LOG_VALIDATE_PREFIX}${layerLabel} geometry check skipped: ${caughtValueMessage(table.selectFailure)}`
    )
    return
  }

  const unreadableCount = countUnreadableGeometries(table.geometryTypes)
  if (unreadableCount > INTEGER_COUNT_NONE) {
    logger.warn(
      `${LOG_VALIDATE_PREFIX}${unreadableCount} unreadable geometry blob(s) in ${layerLabel} (table: ${table.tableName})`
    )
    errors.push(
      makeError(
        unreadableErrorCode,
        `${layerLabel} contains unreadable geometry`
      )
    )
    return
  }

  pushExpectedGeometryTypeErrors({
    geometryCount: table.geometryTypes.length,
    matchingCount: countLinestringGeometries(table.geometryTypes),
    minExpectedCount: LINEAR_LAYER_EXPECTED_MIN_LINESTRING_COUNT,
    insufficientErrorCode: noLinestringErrorCode,
    insufficientMessage: `${layerLabel} has feature(s) but no readable linestring geometry`,
    wrongTypeErrorCode,
    wrongTypeMessage: `${layerLabel} contains feature(s) with non-linestring geometry`,
    errors
  })
}

/**
 * Validates the optional Hedgerows layer: if present and non-empty, every
 * geometry row must be a readable linestring.
 *
 * @param {Map<string, import('./read-feature-tables.js').FeatureTable>} featureTables
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateHedgerows(
  featureTables,
  errors,
  logger = NO_OP_LOGGER
) {
  validateOptionalLinearLayer(featureTables, errors, logger, {
    layerLowerKey: HEDGEROWS_LYR,
    unreadableErrorCode: ERROR_CODES.GPKG_HEDGEROWS_UNREADABLE_GEOMETRY,
    noLinestringErrorCode: ERROR_CODES.GPKG_HEDGEROWS_NO_LINESTRING_GEOMETRY,
    wrongTypeErrorCode: ERROR_CODES.GPKG_HEDGEROWS_WRONG_GEOMETRY_TYPE,
    layerLabel: 'Hedgerows'
  })
}

/**
 * Validates the optional Rivers (watercourses) layer: if present and
 * non-empty, every geometry row must be a readable linestring.
 *
 * @param {Map<string, import('./read-feature-tables.js').FeatureTable>} featureTables
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateWatercourses(
  featureTables,
  errors,
  logger = NO_OP_LOGGER
) {
  validateOptionalLinearLayer(featureTables, errors, logger, {
    layerLowerKey: RIVERS_LYR,
    unreadableErrorCode: ERROR_CODES.GPKG_RIVERS_UNREADABLE_GEOMETRY,
    noLinestringErrorCode: ERROR_CODES.GPKG_RIVERS_NO_LINESTRING_GEOMETRY,
    wrongTypeErrorCode: ERROR_CODES.GPKG_RIVERS_WRONG_GEOMETRY_TYPE,
    layerLabel: 'Rivers'
  })
}
