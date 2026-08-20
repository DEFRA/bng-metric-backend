import { wkbToGeoJSON } from 'bng-library/gpkg-io'

import {
  EPSG_WGS84,
  EPSG_BNG,
  GPKG_MAGIC_BYTE_G,
  GPKG_MAGIC_BYTE_P,
  GPKG_FLAGS_BYTE_INDEX,
  GPKG_HEADER_BYTES,
  GPKG_ENVELOPE_INDICATOR_MASK,
  GPKG_ENVELOPE_SIZES,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  RLB_LYR,
  HABITATS_LYR,
  HEDGEROWS_LYR,
  RIVERS_LYR
} from './geopackage-constants.js'
import {
  SAFE_SQL_IDENTIFIER,
  getWkbType,
  quoteSqliteIdent
} from './geopackage-internals-sqlite.js'

/**
 * Single-pass reader for the feature layers of an open GeoPackage.
 *
 * Every registered feature table we care about is opened, selected and walked
 * exactly once. Each row yields both facts at the same time:
 *
 *  - its WKB geometry type code, which the format gate counts and type-checks
 *    (see geopackage-internals-validate-features.js), and
 *  - its decoded GeoJSON geometry plus attribute columns, which the geometry
 *    and data-quality validation downstream consumes.
 *
 * Reading them together is what removes the second open-and-decode pass the
 * upload route used to pay for (BMD-910).
 */

/** SRIDs the service can hand on to PostGIS. */
const SUPPORTED_SRIDS = new Set([EPSG_WGS84, EPSG_BNG])

/**
 * LAYER_ALIASES: underscored + QGIS spaced names; logical layers resolve
 * case-insensitively, first alias wins.
 */
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
 * Lower-case `gpkg_contents.table_name` keys the format gate counts features
 * for. Read even when no logical layer resolves to them.
 */
const GATE_LAYER_KEYS = new Set([
  RLB_LYR,
  HABITATS_LYR,
  HEDGEROWS_LYR,
  RIVERS_LYR
])

/**
 * @typedef {object} FeatureTable
 * @property {string} tableName actual `gpkg_contents.table_name`
 * @property {boolean} hasGeometryRegistration row present in gpkg_geometry_columns
 * @property {string|null} geometryColumn registered geometry column name
 * @property {boolean} geometryColumnSafe name usable in dynamic SQL
 * @property {number|null} nativeSrid registered `srs_id`
 * @property {number} rowCount rows in the physical table (0 when unqueryable)
 * @property {Array<number|null>|null} geometryTypes WKB type per non-null
 *   geometry blob (null entry = unreadable); null when the scan never ran
 * @property {object[]} features decoded GeoJSON features (decoded layers only)
 * @property {Error|null} selectFailure table/column could not be read
 * @property {Error|null} decodeFailure first geometry that could not be decoded
 */

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
 * Feature layer names as registered in gpkg_contents, in their original case.
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]}
 */
function featureTableNames(db) {
  return db
    .prepare(
      'SELECT table_name FROM gpkg_contents WHERE lower(CAST(data_type AS TEXT)) = ?'
    )
    .all(GPKG_CONTENTS_FEATURES_DATA_TYPE)
    .map((row) => row.table_name)
}

/**
 * Match each logical layer (e.g. 'redline') to a real table name, using the
 * alias list. Case-insensitive, first alias wins.
 * @param {string[]} tableNames
 * @returns {{ logicalTables: Map<string, string>, missingLayers: string[] }}
 */
function resolveLogicalTables(tableNames) {
  const byLowerName = new Map(tableNames.map((t) => [t.toLowerCase(), t]))
  const logicalTables = new Map()
  const missingLayers = []

  for (const [logical, aliases] of Object.entries(LAYER_ALIASES)) {
    const alias = aliases.find((name) => byLowerName.has(name.toLowerCase()))
    if (alias) {
      logicalTables.set(logical, byLowerName.get(alias.toLowerCase()))
    } else {
      missingLayers.push(logical)
    }
  }

  return { logicalTables, missingLayers }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @returns {{ column_name: string, srs_id: number } | undefined}
 */
function geometryRegistration(db, tableName) {
  return db
    .prepare(
      'SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE lower(table_name) = ?'
    )
    .get(tableName.toLowerCase())
}

/**
 * Row count of the physical table, or 0 when it cannot be queried (e.g. the
 * layer is registered in gpkg_contents but the table was never created).
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @returns {number}
 */
function countTableRows(db, tableName) {
  try {
    return db
      .prepare(`SELECT COUNT(*) AS n FROM ${quoteSqliteIdent(tableName)}`)
      .get().n
  } catch {
    return 0
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @returns {string[]}
 */
function tableColumnNames(db, tableName) {
  return db
    .prepare(`PRAGMA table_info(${quoteSqliteIdent(tableName)})`)
    .all()
    .map((column) => column.name)
}

/**
 * Every row of the table, or the error that stopped us reading it.
 * @param {import('better-sqlite3').Database} db
 * @param {FeatureTable} table
 * @returns {object[] | null}
 */
function selectAllRows(db, table) {
  try {
    return db
      .prepare(`SELECT * FROM ${quoteSqliteIdent(table.tableName)}`)
      .all()
  } catch (err) {
    table.selectFailure = err
    return null
  }
}

/**
 * Attribute columns of a row, i.e. everything but the geometry.
 * @param {object} row
 * @param {string} geometryColumn
 */
function featureProperties(row, geometryColumn) {
  const properties = {}
  for (const column of Object.keys(row)) {
    if (column !== geometryColumn) {
      properties[column] = row[column]
    }
  }
  return properties
}

/**
 * Decode one row into a GeoJSON Feature in its native SRID (PostGIS reprojects
 * to 27700 in-query). Returns null for a blob too short to carry a header.
 * @param {object} row
 * @param {Buffer} blob
 * @param {FeatureTable} table
 */
function decodeFeature(row, blob, table) {
  const decoded = decodeGpkgBlob(blob)
  if (!decoded) {
    return null
  }

  const featureSrid = decoded.srsId || table.nativeSrid
  if (!SUPPORTED_SRIDS.has(featureSrid)) {
    throw new Error(
      `Unsupported SRID ${featureSrid} in table ${table.tableName}. ` +
        `Supported: ${[...SUPPORTED_SRIDS].join(', ')}.`
    )
  }

  return {
    type: 'Feature',
    properties: featureProperties(row, table.geometryColumn),
    nativeGeometry: decoded.geometry,
    // Stringified once here so validation, sizing and persist can all reuse
    // it rather than each re-serialising the same geometry. In-memory only.
    geometryJson: JSON.stringify(decoded.geometry),
    nativeSrid: featureSrid
  }
}

/**
 * The single pass: classify and (where wanted) decode every geometry once.
 * A row whose geometry cannot be decoded records the failure and leaves the
 * remaining rows undecoded — the caller decides whether the format gate
 * rejected the file first or whether the failure should surface.
 *
 * @param {object[]} rows
 * @param {FeatureTable} table
 * @param {boolean} decodeGeometry
 */
function scanRows(rows, table, decodeGeometry) {
  const geometryTypes = []

  for (const row of rows) {
    const blob = row[table.geometryColumn]
    if (blob === null || blob === undefined) {
      continue
    }
    geometryTypes.push(getWkbType(blob))
    if (decodeGeometry && !table.decodeFailure) {
      collectFeature(row, blob, table)
    }
  }

  table.geometryTypes = geometryTypes
}

/**
 * @param {object} row
 * @param {Buffer} blob
 * @param {FeatureTable} table
 */
function collectFeature(row, blob, table) {
  try {
    const feature = decodeFeature(row, blob, table)
    if (feature) {
      table.features.push(feature)
    }
  } catch (err) {
    table.decodeFailure = err
  }
}

/**
 * @param {string} tableName
 * @returns {FeatureTable}
 */
function emptyFeatureTable(tableName) {
  return {
    tableName,
    hasGeometryRegistration: false,
    geometryColumn: null,
    geometryColumnSafe: false,
    nativeSrid: null,
    rowCount: 0,
    geometryTypes: null,
    features: [],
    selectFailure: null,
    decodeFailure: null
  }
}

/**
 * Read one registered feature layer end to end.
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {boolean} decodeGeometry decode geometries as well as classify them
 * @returns {FeatureTable}
 */
function readFeatureTable(db, tableName, decodeGeometry) {
  const table = emptyFeatureTable(tableName)
  table.rowCount = countTableRows(db, tableName)

  const registration = geometryRegistration(db, tableName)
  if (!registration) {
    return table
  }
  table.hasGeometryRegistration = true
  table.geometryColumn = registration.column_name
  table.nativeSrid = registration.srs_id
  if (!SAFE_SQL_IDENTIFIER.test(table.geometryColumn)) {
    return table
  }
  table.geometryColumnSafe = true

  const rows = selectAllRows(db, table)
  if (!rows) {
    return table
  }
  if (!tableColumnNames(db, tableName).includes(table.geometryColumn)) {
    table.selectFailure = new Error(`no such column: ${table.geometryColumn}`)
    return table
  }

  scanRows(rows, table, decodeGeometry)
  return table
}

/**
 * Read every feature layer the service cares about from an open GeoPackage —
 * one open, one SELECT and one walk per layer.
 *
 * Without `decodeGeometry` only the layers the format gate counts are read,
 * and their geometries are classified but not unpacked. With it, the layers
 * that carry data are decoded in the same walk, so nothing has to open the
 * file a second time to get at the shapes.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ decodeGeometry?: boolean }} [options]
 * @returns {{
 *   tables: Map<string, FeatureTable>,
 *   logicalTables: Map<string, string>,
 *   missingLayers: string[],
 *   tableNames: string[]
 * }}
 */
export function readFeatureTables(db, { decodeGeometry = false } = {}) {
  const tableNames = featureTableNames(db)
  const { logicalTables, missingLayers } = resolveLogicalTables(tableNames)
  const decodedTables = decodeGeometry
    ? new Set(logicalTables.values())
    : new Set()

  const tables = new Map()
  for (const tableName of tableNames) {
    const decodeTable = decodedTables.has(tableName)
    if (decodeTable || GATE_LAYER_KEYS.has(tableName.toLowerCase())) {
      tables.set(
        tableName.toLowerCase(),
        readFeatureTable(db, tableName, decodeTable)
      )
    }
  }

  return { tables, logicalTables, missingLayers, tableNames }
}

/**
 * Shape the result of {@link readFeatureTables} into the layers object the
 * geometry and data-quality validation consumes.
 *
 * A layer that could not be read or decoded throws here rather than during the
 * read, so that a file the format gate rejects reports its validation errors
 * instead of an exception.
 *
 * @param {ReturnType<typeof readFeatureTables>} featureTables
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
export function toLayers({ tables, logicalTables, missingLayers }) {
  const layers = {}
  for (const logical of Object.keys(LAYER_ALIASES)) {
    layers[logical] = []
  }

  for (const [logical, tableName] of logicalTables) {
    const table = tables.get(tableName.toLowerCase())
    const failure = table.selectFailure ?? table.decodeFailure
    if (failure) {
      throw failure
    }
    layers[logical] = table.features
  }

  layers.missingLayers = missingLayers
  return layers
}
