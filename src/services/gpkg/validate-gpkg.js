import Database from 'better-sqlite3'

import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * GeoPackage Application IDs as per the OGC GeoPackage spec.
 * GP10 covers v1.0; GPKG covers v1.2.1+.
 */
const GPKG_APPLICATION_IDS = new Set([
  0x47503130, // 'GP10' — GeoPackage 1.0
  0x47504b47 // 'GPKG' — GeoPackage 1.2.1+
])

/**
 * System tables that every valid GeoPackage must contain.
 */
const REQUIRED_SYSTEM_TABLES = [
  'gpkg_contents',
  'gpkg_geometry_columns',
  'gpkg_spatial_ref_sys'
]

/**
 * Feature layer names that must be present in gpkg_contents.
 * Matched against the `table_name` column (case-insensitive).
 * TODO: BMD-361 — confirm exact table names with domain team.
 */
const REQUIRED_LAYERS = ['Red Line Boundary', 'Habitats']

/**
 * WKB type codes for Polygon and MultiPolygon, including Z/M/ZM variants.
 * https://www.geopackage.org/spec/#geometry_types
 */
const POLYGON_WKB_TYPES = new Set([
  3,
  6, // Polygon, MultiPolygon
  1003,
  1006, // PolygonZ, MultiPolygonZ
  2003,
  2006, // PolygonM, MultiPolygonM
  3003,
  3006 // PolygonZM, MultiPolygonZM
])

/**
 * Number of envelope bytes for each GeoPackageBinary envelope indicator value.
 * https://www.geopackage.org/spec/#gpb_format
 */
const GPKG_ENVELOPE_SIZES = [0, 32, 48, 48, 64]

/**
 * Extract the WKB geometry type code from a GeoPackageBinary blob.
 * Returns null if the blob is too short or has an unrecognised envelope indicator.
 * @param {Buffer} blob
 * @returns {number|null}
 */
function getWkbType(blob) {
  if (!blob || blob.length < 8) return null
  const envelopeIndicator = (blob[3] >> 1) & 0x07
  const envelopeSize = GPKG_ENVELOPE_SIZES[envelopeIndicator]
  if (envelopeSize === undefined) return null
  const wkbOffset = 8 + envelopeSize
  if (blob.length < wkbOffset + 5) return null
  const littleEndian = blob[wkbOffset] === 1
  return littleEndian
    ? blob.readUInt32LE(wkbOffset + 1)
    : blob.readUInt32BE(wkbOffset + 1)
}

/**
 * Validate that a Buffer contains a valid BNG baseline GeoPackage.
 * Checks are layered — each stage only runs if the previous one passes.
 *
 * @param {Buffer} buffer - Raw file bytes
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateGpkg(buffer) {
  const errors = []
  let db

  try {
    db = new Database(buffer)
  } catch (err) {
    // better-sqlite3 does not throw in the constructor for most invalid buffers
    // (it defers the error to the first operation). This catch covers the cases
    // where it does throw (e.g. null/undefined input), which cannot be reliably
    // reproduced in tests without depending on internal better-sqlite3 behaviour.
    /* v8 ignore next 3 */
    logger.info(
      `validateGpkg: failed to open as SQLite database: ${err.message}`
    )
    return { valid: false, errors: ['File is not a valid GeoPackage'] }
  }

  try {
    // 1. Application ID confirms this is a GeoPackage, not a plain SQLite file
    let appId
    try {
      appId = db.pragma('application_id', { simple: true })
    } catch {
      // better-sqlite3 opens some corrupt buffers without throwing in the
      // constructor, but throws here when it tries to read the file header.
      // No reliable way to craft such a buffer in tests without depending on
      // internal better-sqlite3 behaviour, so this branch is excluded.
      /* v8 ignore next 2 */
      return { valid: false, errors: ['File is not a valid GeoPackage'] }
    }
    if (!GPKG_APPLICATION_IDS.has(appId)) {
      errors.push(
        `File is not a GeoPackage (application_id 0x${appId.toString(16).toUpperCase()} is not a recognised GeoPackage identifier)`
      )
      return { valid: false, errors }
    }

    // 2. Required system tables
    const existingTables = getTableNames(db)
    for (const table of REQUIRED_SYSTEM_TABLES) {
      if (!existingTables.has(table)) {
        errors.push(`Missing required GeoPackage system table: ${table}`)
      }
    }
    if (errors.length > 0) {
      return { valid: false, errors }
    }

    // 3. Required feature layers in gpkg_contents
    const contentTables = new Set(
      db
        .prepare(
          "SELECT lower(table_name) AS table_name FROM gpkg_contents WHERE data_type = 'features'"
        )
        .all()
        .map((row) => row.table_name)
    )
    for (const layer of REQUIRED_LAYERS) {
      if (!contentTables.has(layer.toLowerCase())) {
        errors.push(`Missing required feature layer in GeoPackage: ${layer}`)
      }
    }

    // 4. Red Line Boundary must contain exactly one polygon feature
    if (contentTables.has('red line boundary')) {
      const { table_name: rlbTableName } = db
        .prepare(
          "SELECT table_name FROM gpkg_contents WHERE lower(table_name) = 'red line boundary' AND data_type = 'features'"
        )
        .get()
      const geomRow = db
        .prepare(
          "SELECT column_name FROM gpkg_geometry_columns WHERE lower(table_name) = 'red line boundary'"
        )
        .get()
      if (!geomRow) {
        errors.push(
          'Red Line Boundary layer has no registered geometry column in gpkg_geometry_columns'
        )
      } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(geomRow.column_name)) {
        errors.push(
          'Red Line Boundary geometry column has an invalid name in gpkg_geometry_columns'
        )
      } else {
        const rows = db
          .prepare(
            `SELECT "${geomRow.column_name}" AS geom FROM "${rlbTableName}" WHERE "${geomRow.column_name}" IS NOT NULL`
          )
          .all()
        const unreadableCount = rows.filter(
          (row) => getWkbType(row.geom) === null
        ).length
        if (unreadableCount > 0) {
          logger.warn(
            `validateGpkg: ${unreadableCount} unreadable geometry blob(s) in Red Line Boundary (table: ${rlbTableName})`
          )
          errors.push('Red Line Boundary contains unreadable geometry')
        } else {
          const polygonCount = rows.filter((row) =>
            POLYGON_WKB_TYPES.has(getWkbType(row.geom))
          ).length
          if (polygonCount === 0) {
            errors.push(
              'Zero red line boundaries in GeoPackage (expecting one)'
            )
          } else if (polygonCount > 1) {
            errors.push(
              'Too many red line boundaries in GeoPackage (expecting one)'
            )
          }
        }
      }
    }

    const valid = errors.length === 0
    logger.info(
      `validateGpkg: valid=${valid}, errors=${JSON.stringify(errors)}`
    )
    return { valid, errors }
  } finally {
    db.close()
  }
}

/**
 * Returns a Set of lower-cased table names present in the database.
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<string>}
 */
function getTableNames(db) {
  return new Set(
    db
      .prepare(
        "SELECT lower(name) AS name FROM sqlite_master WHERE type = 'table'"
      )
      .all()
      .map((row) => row.name)
  )
}

export { validateGpkg }
