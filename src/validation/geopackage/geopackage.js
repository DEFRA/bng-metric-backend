import Database from 'better-sqlite3'
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
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

// SQLite header — https://www.sqlite.org/fileformat.html §1.3
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0')

/**
 * Does the file begin with the SQLite magic string?
 *
 * Only the first bytes are read: a file that is not a SQLite database at all is
 * the common rejection, and answering it should not cost a database open — nor,
 * now that uploads are streamed to disk (BMD-913), a read of the whole file.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function fileStartsWithSqliteMagic(filePath) {
  const header = Buffer.alloc(SQLITE_MAGIC.length)
  let fd
  try {
    fd = openSync(filePath, 'r')
    const bytesRead = readSync(fd, header, 0, header.length, 0)
    return bytesRead === header.length && header.equals(SQLITE_MAGIC)
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
}

/**
 * Open the staged upload read-only. Returns null for anything SQLite will not
 * open, which the caller reports as an invalid file.
 *
 * @param {string} filePath
 * @returns {import('better-sqlite3').Database | null}
 */
function openGpkgDatabase(filePath) {
  try {
    return new Database(filePath, { readonly: true, fileMustExist: true })
  } catch (err) {
    logger.info(
      `validateAndReadGpkg: failed to open ${filePath} as SQLite database: ${err.message}`
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
 * Open a candidate GeoPackage file and hand the open database to `withDb`.
 *
 * The file is opened where it already lies — the upload is streamed to disk by
 * the route, so there is nothing to stage and no in-memory copy to make. A
 * WAL-mode header needs no special handling for the same reason: SQLite reads
 * it from the file directly. The database is closed before returning.
 *
 * @param {string} filePath
 * @param {(db: import('better-sqlite3').Database) => T} withDb
 * @returns {T | { valid: false, errors: Array<{ code: string, message: string }> }}
 * @template T
 */
function withGpkgDatabase(filePath, withDb) {
  if (!fileStartsWithSqliteMagic(filePath)) {
    return invalidFileResult()
  }

  const db = openGpkgDatabase(filePath)
  if (!db) {
    return invalidFileResult()
  }
  return useAndClose(db, withDb)
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
 */
function runGpkgGate(db) {
  const structural = runStructuralChecks(db)
  if (!structural.valid) {
    return { ...structural, featureTables: null }
  }

  const featureTables = readFeatureTables(db, { decodeGeometry: true })
  const errors = runFeatureChecks(featureTables)
  return { valid: errors.length === 0, errors, featureTables }
}

/**
 * Validate a file as a BNG baseline GeoPackage and, when it passes, return its
 * layers from the same read.
 *
 * The structural checks run first and reject a broken file before any shape is
 * unpacked. Only then is the file walked — once — classifying and decoding
 * every geometry in a single pass, so the caller needs no second open of the
 * file to get the data (BMD-910).
 *
 * @param {string} filePath a staged upload on local disk
 * @returns {{
 *   valid: boolean,
 *   errors: Array<{ code: string, message: string }>,
 *   layers: ReturnType<typeof toLayers> | null
 * }}
 */
function validateAndReadGpkg(filePath) {
  const result = withGpkgDatabase(filePath, (db) => {
    const gate = runGpkgGate(db)
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
    `validateAndReadGpkg: valid=${result.valid}, errors=${JSON.stringify(result.errors)}`
  )
  return result
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

export { validateAndReadGpkg }
