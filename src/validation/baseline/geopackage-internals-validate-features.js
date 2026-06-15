import { ERROR_CODES, makeError } from './errors.js'
import {
  POLYGON_WKB_TYPES,
  LINESTRING_WKB_TYPES,
  RLB_LYR,
  HABITATS_LYR,
  HEDGEROWS_LYR,
  RIVERS_LYR,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  RL_BOUNDARY_EXPECTED_POLYGON_COUNT,
  HABITATS_EXPECTED_MIN_POLYGON_COUNT,
  LINEAR_LAYER_EXPECTED_MIN_LINESTRING_COUNT
} from './geopackage-constants.js'
import {
  SAFE_SQL_IDENTIFIER,
  getWkbType,
  quoteSqliteIdent,
  caughtValueMessage
} from './geopackage-internals-sqlite.js'

/** Comparator baseline for “more than zero countable items” checks. */
const INTEGER_COUNT_NONE = 0

const LOG_VALIDATE_PREFIX = 'validateGpkg: '

/** @type {{ warn: (msg: string) => void }} */
const NO_OP_LOGGER = { warn: () => {} }

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} layerLowerKey lower(table_name) canonical key
 */
function featureLayerContentsRow(db, layerLowerKey) {
  return db
    .prepare(
      `SELECT table_name FROM gpkg_contents
       WHERE lower(table_name) = ? AND lower(CAST(data_type AS TEXT)) = ?`
    )
    .get(layerLowerKey, GPKG_CONTENTS_FEATURES_DATA_TYPE)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} layerLowerKey
 */
function geomColumnNameRow(db, layerLowerKey) {
  return db
    .prepare(
      `SELECT column_name FROM gpkg_geometry_columns WHERE lower(table_name) = ?`
    )
    .get(layerLowerKey)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {string} geomColumnName
 * @returns {Array<{ geom: Buffer }>}
 */
function selectNonNullGeometryRows(db, tableName, geomColumnName) {
  const qc = quoteSqliteIdent(geomColumnName)
  const qt = quoteSqliteIdent(tableName)
  return db
    .prepare(`SELECT ${qc} AS geom FROM ${qt} WHERE ${qc} IS NOT NULL`)
    .all()
}

/**
 * @returns {Array<{ geom: Buffer }> | undefined} undefined when SELECT fails
 */
function selectNonNullGeometryRowsOrLog(
  db,
  tableName,
  geomColumnName,
  logger,
  skipMessage
) {
  try {
    return selectNonNullGeometryRows(db, tableName, geomColumnName)
  } catch (err) {
    const detail = caughtValueMessage(err)
    logger.warn(`${LOG_VALIDATE_PREFIX}${skipMessage(detail)}`)
    return undefined
  }
}

/**
 * @param {Array<{ geom: Buffer }>} rows
 */
function countUnreadableGeomRows(rows) {
  return rows.filter((row) => getWkbType(row.geom) === null).length
}

/**
 * @param {Array<{ geom: Buffer }>} rows
 */
function countPolygonGeomRows(rows) {
  return rows.filter((row) => POLYGON_WKB_TYPES.has(getWkbType(row.geom)))
    .length
}

/**
 * @param {Array<{ geom: Buffer }>} rows
 */
function countLinestringGeomRows(rows) {
  return rows.filter((row) => LINESTRING_WKB_TYPES.has(getWkbType(row.geom)))
    .length
}

/**
 * Count rows in a table registered in gpkg_contents by its lower-case key.
 * Returns 0 if the table cannot be queried (e.g. not yet created).
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName actual table name (not lower-cased key)
 * @returns {number}
 */
function countTableRows(db, tableName) {
  try {
    const qt = quoteSqliteIdent(tableName)
    return db.prepare(`SELECT COUNT(*) AS n FROM ${qt}`).get().n
  } catch {
    return 0
  }
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
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateRedLineBoundary(db, errors, logger = NO_OP_LOGGER) {
  const meta = featureLayerContentsRow(db, RLB_LYR)
  if (!meta) {
    return
  }
  const { table_name: rlbTableName } = meta
  const geomRow = geomColumnNameRow(db, RLB_LYR)

  if (!geomRow) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_RLB_NO_GEOMETRY_COLUMN,
        'Red Line Boundary layer has no registered geometry column in gpkg_geometry_columns'
      )
    )
    return
  }
  if (!SAFE_SQL_IDENTIFIER.test(geomRow.column_name)) {
    // compareGeometryRegistrationRow (step 4) pushes GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME
    // when the name is not a safe SQLite identifier — do not run polygon counts.
    return
  }

  const rows = selectNonNullGeometryRowsOrLog(
    db,
    rlbTableName,
    geomRow.column_name,
    logger,
    (detail) => `Red Line Boundary polygon count skipped: ${detail}`
  )
  if (!rows) {
    return
  }

  const unreadableCount = countUnreadableGeomRows(rows)
  if (unreadableCount > INTEGER_COUNT_NONE) {
    logger.warn(
      `${LOG_VALIDATE_PREFIX}${unreadableCount} unreadable geometry blob(s) in Red Line Boundary (table: ${rlbTableName})`
    )
    errors.push(
      makeError(
        ERROR_CODES.GPKG_RLB_UNREADABLE_GEOMETRY,
        'Red Line Boundary contains unreadable geometry'
      )
    )
    return
  }

  pushRlPolygonCountErrors(countPolygonGeomRows(rows), errors)
}

/**
 * When a layer has readable geometry rows, every row must match the expected
 * WKB type and at least {@link minExpectedCount} rows must do so.
 *
 * @param {object} params
 * @param {Array<{ geom: Buffer }>} params.rows
 * @param {number} params.matchingCount
 * @param {number} params.minExpectedCount
 * @param {string} params.insufficientErrorCode
 * @param {string} params.insufficientMessage
 * @param {string} params.wrongTypeErrorCode
 * @param {string} params.wrongTypeMessage
 * @param {string[]} params.errors
 */
function pushExpectedGeometryTypeErrors({
  rows,
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
  if (matchingCount < rows.length) {
    errors.push(makeError(wrongTypeErrorCode, wrongTypeMessage))
  }
}

/**
 * Habitats must include at least one readable polygon/multipolygon feature,
 * and every non-null geometry row must be a polygon or multipolygon.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateHabitats(db, errors, logger = NO_OP_LOGGER) {
  const meta = featureLayerContentsRow(db, HABITATS_LYR)
  if (!meta) {
    return
  }
  const { table_name: habitatsTableName } = meta
  const geomRow = geomColumnNameRow(db, HABITATS_LYR)

  if (!geomRow) {
    return
  }
  if (!SAFE_SQL_IDENTIFIER.test(geomRow.column_name)) {
    return
  }

  const rows = selectNonNullGeometryRowsOrLog(
    db,
    habitatsTableName,
    geomRow.column_name,
    logger,
    (detail) => `Habitats parcel check skipped: ${detail}`
  )
  if (!rows) {
    return
  }

  const unreadableCount = countUnreadableGeomRows(rows)
  if (unreadableCount > INTEGER_COUNT_NONE) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_HABITATS_UNREADABLE_GEOMETRY,
        'Habitats contains unreadable geometry'
      )
    )
    return
  }

  const polygonCount = countPolygonGeomRows(rows)
  pushExpectedGeometryTypeErrors({
    rows,
    matchingCount: polygonCount,
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
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} logger
 * @param {object} layerConfig
 * @param {string} layerConfig.layerLowerKey lower(table_name) used in gpkg_contents
 * @param {string} layerConfig.unreadableErrorCode ERROR_CODES key for unreadable geometry
 * @param {string} layerConfig.noLinestringErrorCode ERROR_CODES key when no linestrings
 * @param {string} layerConfig.wrongTypeErrorCode ERROR_CODES key for mixed geometry types
 * @param {string} layerConfig.layerLabel human-readable name for log messages
 */
function validateOptionalLinearLayer(db, errors, logger, layerConfig) {
  const {
    layerLowerKey,
    unreadableErrorCode,
    noLinestringErrorCode,
    wrongTypeErrorCode,
    layerLabel
  } = layerConfig
  const meta = featureLayerContentsRow(db, layerLowerKey)
  if (!meta) {
    return
  }
  const { table_name: tableName } = meta

  const rowCount = countTableRows(db, tableName)
  if (rowCount === INTEGER_COUNT_NONE) {
    return
  }

  const geomRow = geomColumnNameRow(db, layerLowerKey)
  if (!geomRow) {
    return
  }
  if (!SAFE_SQL_IDENTIFIER.test(geomRow.column_name)) {
    return
  }

  const rows = selectNonNullGeometryRowsOrLog(
    db,
    tableName,
    geomRow.column_name,
    logger,
    (detail) => `${layerLabel} geometry check skipped: ${detail}`
  )
  if (!rows) {
    return
  }

  const unreadableCount = countUnreadableGeomRows(rows)
  if (unreadableCount > INTEGER_COUNT_NONE) {
    logger.warn(
      `${LOG_VALIDATE_PREFIX}${unreadableCount} unreadable geometry blob(s) in ${layerLabel} (table: ${tableName})`
    )
    errors.push(
      makeError(
        unreadableErrorCode,
        `${layerLabel} contains unreadable geometry`
      )
    )
    return
  }

  const linestringCount = countLinestringGeomRows(rows)
  pushExpectedGeometryTypeErrors({
    rows,
    matchingCount: linestringCount,
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
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateHedgerows(db, errors, logger = NO_OP_LOGGER) {
  validateOptionalLinearLayer(db, errors, logger, {
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
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} errors
 * @param {{ warn: (msg: string) => void }} [logger]
 */
export function validateWatercourses(db, errors, logger = NO_OP_LOGGER) {
  validateOptionalLinearLayer(db, errors, logger, {
    layerLowerKey: RIVERS_LYR,
    unreadableErrorCode: ERROR_CODES.GPKG_RIVERS_UNREADABLE_GEOMETRY,
    noLinestringErrorCode: ERROR_CODES.GPKG_RIVERS_NO_LINESTRING_GEOMETRY,
    wrongTypeErrorCode: ERROR_CODES.GPKG_RIVERS_WRONG_GEOMETRY_TYPE,
    layerLabel: 'Rivers'
  })
}
