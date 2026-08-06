import Database from 'better-sqlite3'
import { wkbToGeoJSON } from 'bng-library/gpkg-io'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger } from '../../common/helpers/logging/logger.js'
import { ERROR_CODES, makeError } from './errors.js'
import {
  GPKG_APPLICATION_IDS,
  EPSG_WGS84,
  EPSG_BNG,
  GPKG_MAGIC_BYTE_G,
  GPKG_MAGIC_BYTE_P,
  GPKG_FLAGS_BYTE_INDEX,
  GPKG_HEADER_BYTES,
  GPKG_ENVELOPE_INDICATOR_MASK,
  GPKG_ENVELOPE_SIZES,
  RLB_LYR,
  HABITATS_LYR,
  HEDGEROWS_LYR,
  RIVERS_LYR,
  GPKG_CONTENTS_FEATURES_DATA_TYPE
} from './geopackage-constants.js'
import {
  compareGpkgToBaselineSchema,
  validateRedLineBoundary,
  validateHabitats,
  validateHedgerows,
  validateWatercourses
} from './geopackage-internals.js'

const logger = createLogger()

// MERGE NOTE (PR #16): runs after that PR's validateGpkg format gate. Long
// term, collapse both readers into a single SQLite open pass.

const baselineTemplateSchema = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      'reference',
      'baseline-template.schema.json'
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

const SUPPORTED_SRIDS = new Set([EPSG_WGS84, EPSG_BNG])

/** Prefix for the ephemeral directory used to stage an uploaded buffer on disk. */
const GPKG_GATE_STAGING_PREFIX = 'gpkg-gate-'
const GPKG_GATE_STAGING_FILENAME = 'candidate.gpkg'

// OGC GeoPackage 1.2 §2.1.3 — geometry blob header layout uses GPKG_MAGIC_BYTE_* /
// GPKG_FLAGS_BYTE_INDEX / GPKG_ENVELOPE_* from ./geopackage-constants.js

// Aliases cover both the underscored canonical names and the QGIS display
// names with spaces. resolveTableName is case-insensitive, so spaces are the
// only thing that matters here.
const LAYER_ALIASES = {
  redline: [
    'red_line_boundary',
    'redline_boundary',
    'redline',
    'red_line',
    RLB_LYR
  ],
  areas: [
    'area_habitats',
    'baseline_area_habitats',
    'habitat_areas',
    'areas',
    'habitats'
  ],
  hedgerows: ['hedgerow_habitats', 'baseline_hedgerow_habitats', 'hedgerows'],
  watercourses: [
    'watercourse_habitats',
    'baseline_watercourse_habitats',
    'watercourses',
    'rivers'
  ],
  iggis: ['iggis', 'iggi', 'integrated_greening_grey_infrastructure'],
  trees: ['trees', 'baseline_trees', 'tree', 'urban trees']
}

/**
 * Stage the uploaded buffer to a real file on disk and open it there.
 *
 * GeoPackages last closed in WAL journal mode (SQLite file-format read
 * version 2) cannot be opened from an in-memory buffer via
 * sqlite3_deserialize (`new Database(buffer)`) — WAL mode requires a real
 * filesystem-backed -shm file — so the upload is staged to a real file on
 * disk and opened through better-sqlite3's normal file-based VFS instead.
 *
 * Writing the staged file is intentionally outside the try/catch below: a
 * filesystem failure there (e.g. ENOSPC, EACCES, EROFS) is an infrastructure
 * error, not an invalid upload, and must propagate rather than being coerced
 * into GPKG_INVALID_FILE. Only a failure to open the staged file as SQLite
 * counts as an invalid upload.
 *
 * @param {Buffer} buffer
 * @param {string} stagingDir - Pre-created, privately-owned staging directory.
 * @returns {import('better-sqlite3').Database | null}
 */
function openStagedGpkgDatabase(buffer, stagingDir) {
  const stagingPath = join(stagingDir, GPKG_GATE_STAGING_FILENAME)
  writeFileSync(stagingPath, buffer)

  try {
    return new Database(stagingPath, { readonly: true, fileMustExist: true })
  } catch (err) {
    // better-sqlite3 does not throw in the constructor for most invalid files
    // (it defers the error to the first operation). This catch covers the cases
    // where it does throw (e.g. null/undefined input), which cannot be reliably
    // reproduced in tests without depending on internal better-sqlite3 behaviour.
    /* v8 ignore next 3 */
    logger.info(
      `validateGpkg: failed to open staged file as SQLite database: ${err.message}`
    )
    return null
  }
}

/**
 * Run the layered GeoPackage checks against an already-open database.
 * Each stage only runs if the previous one passes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string }> }}
 */
function runGpkgChecks(db) {
  const errors = []

  // 1. Application ID confirms this is a GeoPackage, not a plain SQLite file
  let appId
  try {
    appId = db.pragma('application_id', { simple: true })
  } catch {
    // better-sqlite3 opens some corrupt files without throwing on open, but
    // throws here when it tries to read the file header. No reliable way to
    // craft such a file in tests without depending on internal better-sqlite3
    // behaviour, so this branch is excluded.
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

  // 3. Required feature layers (from baseline-template.schema.json)
  const contentTables = getFeatureLayerNames(db)
  checkRequiredLayersFromSchema(baselineTemplateSchema, contentTables, errors)

  // 4. Layers present in gpkg_contents must match baseline template columns, srs, geometry
  compareGpkgToBaselineSchema(db, baselineTemplateSchema, errors)

  // 5. Red Line Boundary must contain exactly one polygon feature
  if (contentTables.has(RLB_LYR)) {
    validateRedLineBoundary(db, errors, logger)
  }

  if (contentTables.has(HABITATS_LYR)) {
    validateHabitats(db, errors, logger)
  }

  // Hedgerows and Rivers are optional layers. Only validate when present;
  // the validator itself skips silently when the table has zero rows.
  if (contentTables.has(HEDGEROWS_LYR)) {
    validateHedgerows(db, errors, logger)
  }
  if (contentTables.has(RIVERS_LYR)) {
    validateWatercourses(db, errors, logger)
  }

  const valid = errors.length === 0
  logger.info(`validateGpkg: valid=${valid}, errors=${JSON.stringify(errors)}`)
  return { valid, errors }
}

/**
 * Validate that a Buffer contains a valid BNG baseline GeoPackage.
 *
 * @param {Buffer} buffer - Raw file bytes
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string }> }}
 */
function validateGpkg(buffer) {
  const stagingDir = mkdtempSync(join(tmpdir(), GPKG_GATE_STAGING_PREFIX))
  try {
    const db = openStagedGpkgDatabase(buffer, stagingDir)
    if (!db) {
      return { valid: false, errors: [INVALID_FILE_ERROR] }
    }
    try {
      return runGpkgChecks(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
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
 * Checks that every layer marked required in baseline-template.schema.json is present.
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
 * Decode a GeoPackage geometry blob into a GeoJSON geometry and its SRS id.
 *
 * The GeoPackageBinary header is validated here (magic + envelope indicator,
 * per OGC GeoPackage 1.2 §2.1.3) so a malformed baseline is rejected rather
 * than silently accepted. The WKB → GeoJSON decode itself is delegated to
 * bng-library/gpkg-io (`wkbToGeoJSON`), which is the single source of truth
 * for the format.
 *
 * @param {Buffer} blob
 * @returns {{ geometry: object, srsId: number } | null}
 */
function decodeGpkgBlob(blob) {
  if (!blob || blob.length < GPKG_HEADER_BYTES) {
    return null
  }
  if (blob[0] !== GPKG_MAGIC_BYTE_G || blob[1] !== GPKG_MAGIC_BYTE_P) {
    throw new Error('Invalid GeoPackage geometry blob: bad magic')
  }
  const flags = blob[GPKG_FLAGS_BYTE_INDEX]
  const envelopeIndicator = (flags >> 1) & GPKG_ENVELOPE_INDICATOR_MASK
  if (GPKG_ENVELOPE_SIZES[envelopeIndicator] === undefined) {
    throw new Error(
      `Invalid GeoPackage envelope indicator: ${envelopeIndicator}`
    )
  }
  const isLittleEndian = (flags & 0x01) === 1
  const srsId = isLittleEndian ? blob.readInt32LE(4) : blob.readInt32BE(4)
  return { geometry: wkbToGeoJSON(blob), srsId }
}

/**
 * Match a logical layer name (e.g. 'redline') to a real table name in the
 * GeoPackage, using the alias list. Case-insensitive.
 */
function resolveTableName(logicalName, availableTables) {
  const aliases = LAYER_ALIASES[logicalName] ?? [logicalName]
  const lower = new Map(availableTables.map((t) => [t.toLowerCase(), t]))
  for (const alias of aliases) {
    const hit = lower.get(alias.toLowerCase())
    if (hit) {
      return hit
    }
  }
  return null
}

/**
 * Read all features from a single GeoPackage feature table, returning them as
 * GeoJSON Features in their native SRID (PostGIS reprojects to 27700 in-query).
 */
function readLayer(db, tableName) {
  const geomColumnRow = db
    .prepare(
      'SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?'
    )
    .get(tableName)
  if (!geomColumnRow) {
    return { nativeSrid: null, features: [] }
  }

  const { column_name: geomColumn, srs_id: tableSrid } = geomColumnRow

  // QGIS-authored layer names contain spaces (e.g. "Red Line Boundary"), so the
  // identifier has to be double-quoted in the prepared SQL. PRAGMA and SELECT *
  // can't take bound parameters for object names, hence the inline quoting.
  const quotedTable = `"${tableName.replaceAll('"', '""')}"`

  // Discover non-geometry columns to attach as feature properties.
  const colRows = db.prepare(`PRAGMA table_info(${quotedTable})`).all()
  const propColumns = colRows.map((c) => c.name).filter((n) => n !== geomColumn)

  const rows = db.prepare(`SELECT * FROM ${quotedTable}`).all()
  const features = []
  for (const row of rows) {
    const blob = row[geomColumn]
    const decoded = decodeGpkgBlob(blob)
    if (!decoded) {
      continue
    }

    const featureSrid = decoded.srsId || tableSrid
    if (!SUPPORTED_SRIDS.has(featureSrid)) {
      throw new Error(
        `Unsupported SRID ${featureSrid} in table ${tableName}. ` +
          `Supported: ${[...SUPPORTED_SRIDS].join(', ')}.`
      )
    }

    const properties = {}
    for (const col of propColumns) {
      properties[col] = row[col]
    }

    features.push({
      type: 'Feature',
      properties,
      nativeGeometry: decoded.geometry,
      nativeSrid: featureSrid
    })
  }
  return { nativeSrid: tableSrid, features }
}

/**
 * Open a GeoPackage and return all layers we know about as GeoJSON Features
 * carrying their native geometry and SRID. PostGIS reprojects to 27700
 * in-query for area / containment checks.
 *
 * @param {string} filePath
 * @returns {{
 *   redline: object[],
 *   areas: object[],
 *   hedgerows: object[],
 *   watercourses: object[],
 *   iggis: object[],
 *   trees: object[],
 *   missingLayers: string[]
 * }}
 */
export function readBaselineGeoPackage(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const tables = db
      .prepare(
        'SELECT table_name FROM gpkg_contents WHERE lower(CAST(data_type AS TEXT)) = ?'
      )
      .all(GPKG_CONTENTS_FEATURES_DATA_TYPE)
      .map((r) => r.table_name)

    logger.info(
      `readBaselineGeoPackage - file: ${filePath}, feature tables: ${JSON.stringify(tables)}`
    )

    const result = {
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: [],
      missingLayers: []
    }

    for (const logical of Object.keys(LAYER_ALIASES)) {
      const table = resolveTableName(logical, tables)
      if (!table) {
        result.missingLayers.push(logical)
        continue
      }
      result[logical] = readLayer(db, table).features
    }

    return result
  } finally {
    db.close()
  }
}

export { validateGpkg }
