import { ERROR_CODES, makeError } from './errors.js'
import {
  POLYGON_WKB_TYPES,
  RLB_LYR,
  HABITATS_LYR,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  RL_BOUNDARY_EXPECTED_POLYGON_COUNT,
  HABITATS_EXPECTED_MIN_POLYGON_COUNT
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
    // Exactly RL_BOUNDARY_EXPECTED_POLYGON_COUNT — valid baseline case for RLB polygon count.
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
    // compareGeometryRegistrationRow (step 4) pushes GPKG_RLB_INVALID_GEOMETRY_COLUMN_NAME for
    // Red Line Boundary when the name is not a safe SQLite identifier — do not run polygon counts.
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
 * Habitats must include at least one readable polygon/multipolygon feature.
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
  if (polygonCount < HABITATS_EXPECTED_MIN_POLYGON_COUNT) {
    errors.push(
      makeError(
        ERROR_CODES.NO_HABITAT_AREAS,
        'Zero area habitat parcels in GeoPackage (expecting at least one)'
      )
    )
  }
}
