import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger } from '../../common/helpers/logging/logger.js'
import { ERROR_CODES, makeError } from './errors.js'
import {
  GPKG_APPLICATION_IDS,
  GPKG_CONTENTS_FEATURES_DATA_TYPE
} from './geopackage-constants.js'
import {
  compareGpkgToBaselineSchema,
  validateRedLineBoundary,
  validateHabitats,
  validateHedgerows,
  validateWatercourses
} from './geopackage-internals.js'
import { readFeatureTables, toLayers } from './read-feature-tables.js'

const logger = createLogger()

const baselineTemplateSchema = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'reference',
      'gpkg-template.schema.json'
    ),
    'utf8'
  )
)

/**
 * System tables that every valid GeoPackage must contain.
 */
const REQUIRED_SYSTEM_TABLES = [
  'gpkg_contents',
  'gpkg_geometry_columns',
  'gpkg_spatial_ref_sys'
]

const INVALID_FILE_ERROR = makeError(
  ERROR_CODES.GPKG_INVALID_FILE,
  'File is not a valid GeoPackage'
)

const GPKG_GATE_STAGING_PREFIX = 'gpkg-gate-'
const GPKG_GATE_STAGING_FILENAME = 'candidate.gpkg'
// SQLite header — https://www.sqlite.org/fileformat.html §1.3
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0')
const SQLITE_HEADER_MIN_BYTES = 20
const SQLITE_WAL_VERSION = 2
const SQLITE_READ_VERSION_OFFSET = 19

function bufferStartsWithSqliteMagic(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= SQLITE_MAGIC.length &&
    buffer.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
  )
}

/** True when the SQLite header marks WAL journal mode (read version 2). */
function isWalModeSqliteBuffer(buffer) {
  return (
    bufferStartsWithSqliteMagic(buffer) &&
    buffer.length >= SQLITE_HEADER_MIN_BYTES &&
    buffer[SQLITE_READ_VERSION_OFFSET] === SQLITE_WAL_VERSION
  )
}

/** Fast path: sqlite3_deserialize + probe read (WAL fails here — deferred open). */
function tryOpenBufferDatabase(buffer) {
  let db
  try {
    db = new Database(buffer, { readonly: true })
    db.pragma('application_id', { simple: true })
    return db
  } catch {
    db?.close()
    return null
  }
}

/**
 * Slow path: stage to disk then open. writeFileSync is outside try/catch so
 * ENOSPC/EACCES/EROFS propagate (not coerced to GPKG_INVALID_FILE).
 * @param {Buffer} buffer
 * @param {string} stagingDir
 * @returns {import('better-sqlite3').Database | null}
 */
function openStagedGpkgDatabase(buffer, stagingDir) {
  const stagingPath = join(stagingDir, GPKG_GATE_STAGING_FILENAME)
  writeFileSync(stagingPath, buffer)

  try {
    return new Database(stagingPath, { readonly: true, fileMustExist: true })
  } catch (err) {
    /* v8 ignore next 4 */
    logger.info(
      `validateGpkg: failed to open staged file as SQLite database: ${err.message}`
    )
    return null
  }
}

/** Structural checks that need no shape data — the early exit of the gate. */
function runStructuralChecks(db) {
  const errors = []

  // 1. Application ID confirms this is a GeoPackage, not a plain SQLite file
  let appId
  try {
    appId = db.pragma('application_id', { simple: true })
  } catch {
    /* v8 ignore next 2 */
    return { valid: false, errors: [INVALID_FILE_ERROR] }
  }
  if (!GPKG_APPLICATION_IDS.has(appId)) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_NOT_A_GEOPACKAGE,
        `File is not a GeoPackage (application_id 0x${appId.toString(16).toUpperCase()} is not a recognised GeoPackage identifier)`
      )
    )
    return { valid: false, errors }
  }

  // 2. Required system tables
  checkSystemTables(db, errors)
  if (errors.length > 0) {
    return { valid: false, errors }
  }

  // 3. Required feature layers (from gpkg-template.schema.json)
  const contentTables = getFeatureLayerNames(db)
  checkRequiredLayersFromSchema(baselineTemplateSchema, contentTables, errors)

  // 4. Layers present in gpkg_contents must match baseline template columns, srs, geometry
  compareGpkgToBaselineSchema(db, baselineTemplateSchema, errors)

  return { valid: errors.length === 0, errors }
}

/**
 * Feature-count and geometry-type checks, run against the geometry types the
 * single reader pass classified. Red Line Boundary must contain exactly one
 * polygon; Habitats at least one. Hedgerows and Rivers are optional layers —
 * the validators skip silently when the layer is absent or empty.
 *
 * @param {ReturnType<typeof readFeatureTables>} featureTables
 * @returns {Array<{ code: string, message: string }>}
 */
function runFeatureChecks({ tables }) {
  const errors = []
  validateRedLineBoundary(tables, errors, logger)
  validateHabitats(tables, errors, logger)
  validateHedgerows(tables, errors, logger)
  validateWatercourses(tables, errors, logger)
  return errors
}

/**
 * Open a candidate GeoPackage buffer and hand the open database to `withDb`.
 * WAL-mode headers go straight to disk; otherwise try in-memory first.
 * Non-SQLite failures skip staging; SQLite in-memory failures still fall back
 * to disk. The database is closed and any staging directory removed before
 * returning.
 *
 * @param {Buffer} buffer
 * @param {(db: import('better-sqlite3').Database) => T} withDb
 * @returns {T | { valid: false, errors: Array<{ code: string, message: string }> }}
 * @template T
 */
function withGpkgDatabase(buffer, withDb) {
  if (!isWalModeSqliteBuffer(buffer)) {
    const bufferDb = tryOpenBufferDatabase(buffer)
    if (bufferDb) {
      return useAndClose(bufferDb, withDb)
    }
    if (!bufferStartsWithSqliteMagic(buffer)) {
      return invalidFileResult()
    }
  }

  logger.info(
    'validateGpkg: opening via disk staging (WAL-mode header or in-memory open failed)'
  )
  const stagingDir = mkdtempSync(join(tmpdir(), GPKG_GATE_STAGING_PREFIX))
  try {
    const db = openStagedGpkgDatabase(buffer, stagingDir)
    if (!db) {
      return invalidFileResult()
    }
    return useAndClose(db, withDb)
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

function invalidFileResult() {
  return { valid: false, errors: [INVALID_FILE_ERROR] }
}

function useAndClose(db, withDb) {
  try {
    return withDb(db)
  } finally {
    db.close()
  }
}

/**
 * The format gate against an open database: the structural checks first, and
 * only for a file that survives them, the single reader pass whose geometry
 * types the feature checks count.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} decodeGeometry also unpack the shapes in that same pass
 */
function runGpkgGate(db, decodeGeometry) {
  const structural = runStructuralChecks(db)
  if (!structural.valid) {
    return { ...structural, featureTables: null }
  }

  const featureTables = readFeatureTables(db, { decodeGeometry })
  const errors = runFeatureChecks(featureTables)
  return { valid: errors.length === 0, errors, featureTables }
}

/**
 * Validate a Buffer as a BNG baseline GeoPackage and, when it passes, return
 * its layers from the same read.
 *
 * The structural checks run first and reject a broken file before any shape is
 * unpacked. Only then is the file walked — once — classifying and decoding
 * every geometry in a single pass, so the caller needs no second open of the
 * file to get the data (BMD-910).
 *
 * @param {Buffer} buffer
 * @returns {{
 *   valid: boolean,
 *   errors: Array<{ code: string, message: string }>,
 *   layers: ReturnType<typeof toLayers> | null
 * }}
 */
function validateAndReadGpkg(buffer) {
  const result = withGpkgDatabase(buffer, (db) => {
    const gate = runGpkgGate(db, true)
    if (!gate.valid) {
      return logGateResult({ valid: false, errors: gate.errors })
    }
    return logGateResult({
      valid: true,
      errors: [],
      layers: toLayers(gate.featureTables)
    })
  })
  return { layers: null, ...result }
}

function logGateResult(result) {
  logger.info(
    `validateGpkg: valid=${result.valid}, errors=${JSON.stringify(result.errors)}`
  )
  return result
}

/**
 * Format gate only: is this Buffer an acceptable BNG baseline GeoPackage?
 * Nothing is unpacked — callers that also need the shapes should use
 * {@link validateAndReadGpkg}, which returns them from the same read.
 *
 * @param {Buffer} buffer
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string }> }}
 */
function validateGpkg(buffer) {
  return withGpkgDatabase(buffer, (db) => {
    const { valid, errors } = runGpkgGate(db, false)
    return logGateResult({ valid, errors })
  })
}

/**
 * Checks that all required GeoPackage system tables are present.
 * Pushes an error for each missing table.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} errors
 */
function checkSystemTables(db, errors) {
  const existingTables = getTableNames(db)
  for (const table of REQUIRED_SYSTEM_TABLES) {
    if (!existingTables.has(table)) {
      errors.push(
        makeError(
          ERROR_CODES.GPKG_MISSING_SYSTEM_TABLE,
          `Missing required GeoPackage system table: ${table}`
        )
      )
    }
  }
}

/**
 * Returns lower-cased names of all feature layers registered in gpkg_contents.
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<string>}
 */
function getFeatureLayerNames(db) {
  return new Set(
    db
      .prepare(
        'SELECT lower(table_name) AS table_name FROM gpkg_contents WHERE lower(CAST(data_type AS TEXT)) = ?'
      )
      .all(GPKG_CONTENTS_FEATURES_DATA_TYPE)
      .map((row) => row.table_name)
  )
}

/**
 * Checks that every layer marked required in gpkg-template.schema.json is present.
 * Matched against the `table_name` column in gpkg_contents (case-insensitive).
 * @param {typeof baselineTemplateSchema} schema
 * @param {Set<string>} contentTables - Lower-cased layer names from gpkg_contents
 * @param {string[]} errors
 */
function checkRequiredLayersFromSchema(schema, contentTables, errors) {
  for (const layerDef of schema.layers) {
    if (!layerDef.required) {
      continue
    }
    if (!contentTables.has(layerDef.tableName.toLowerCase())) {
      errors.push(
        makeError(
          ERROR_CODES.GPKG_MISSING_LAYER,
          `Missing required feature layer in GeoPackage: ${layerDef.tableName}`
        )
      )
    }
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

/**
 * Open a GeoPackage file and return all layers we know about as GeoJSON
 * Features carrying their native geometry and SRID. PostGIS reprojects to
 * 27700 in-query for area / containment checks.
 *
 * Upload validation reads from the buffer instead — see
 * {@link validateAndReadGpkg}; this is for callers that already have a file.
 *
 * @param {string} filePath
 * @returns {ReturnType<typeof toLayers>}
 */
export function readGeoPackage(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const featureTables = readFeatureTables(db, { decodeGeometry: true })
    logger.info(
      `readGeoPackage - file: ${filePath}, feature tables: ${JSON.stringify(featureTables.tableNames)}`
    )
    return toLayers(featureTables)
  } finally {
    db.close()
  }
}

export { validateGpkg, validateAndReadGpkg }
