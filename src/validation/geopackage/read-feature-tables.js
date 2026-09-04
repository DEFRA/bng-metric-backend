import { wkbToGeoJSON } from 'bng-library/gpkg-io'

import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  logPerf,
  perfNow,
  msSince,
  memoryUsageMb
} from '../../common/helpers/perf-evidence.js'

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

const logger = createLogger()

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
 * How much of a feature layer a read should materialise.
 *
 * Four modes rather than a boolean, because the two in the middle are the whole
 * point: decoding a geometry blob into a GeoJSON object graph costs roughly 14x
 * the file size, and almost nothing needs the result. The data-quality checks
 * read `feature.properties` and never touch a coordinate; persistence needs the
 * geometry only as the JSON text it binds into SQL. GEOS is the sole consumer
 * of the object graph, and it opens the file itself in its worker.
 *
 * - `classify`   geometry TYPES only; `features` stays empty. What the format
 *                gate needs to answer valid/invalid without unpacking.
 * - `properties` one feature per row carrying its attribute columns, with the
 *                geometry left as an undecoded blob. What the data-quality
 *                checks need.
 * - `serialised` properties plus the geometry as JSON TEXT, with the decoded
 *                object graph dropped. What persistence needs: the insert binds
 *                the text straight into ST_GeomFromGeoJSON and never reads a
 *                coordinate. The object graph costs roughly three times its own
 *                serialisation, so holding only the text is most of the saving.
 * - `full`       properties plus BOTH the object graph and its serialisation.
 *                What GEOS needs — it walks coordinates — and nothing else.
 */
export const FEATURE_READ_MODE = Object.freeze({
  classify: 'classify',
  properties: 'properties',
  serialised: 'serialised',
  full: 'full'
})

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
 * @param {boolean} keepGeometryObject retain the decoded object graph as well
 *   as its serialisation. False for the persistence read, which binds the text
 *   into SQL and never looks at a coordinate.
 */
function decodeFeature(row, blob, table, keepGeometryObject) {
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

  const feature = {
    type: 'Feature',
    properties: featureProperties(row, table.geometryColumn),
    // Stringified once here so validation, sizing and persist can all reuse
    // it rather than each re-serialising the same geometry. In-memory only.
    geometryJson: JSON.stringify(decoded.geometry),
    nativeSrid: featureSrid
  }
  if (keepGeometryObject) {
    feature.nativeGeometry = decoded.geometry
  }
  // Otherwise `decoded.geometry` goes out of scope here and the object graph
  // becomes garbage immediately, leaving only the text behind.
  return feature
}

/**
 * The single pass: classify and (where wanted) decode every geometry once.
 * A row whose geometry cannot be decoded records the failure and leaves the
 * remaining rows undecoded — the caller decides whether the format gate
 * rejected the file first or whether the failure should surface.
 *
 * @param {object[]} rows
 * @param {FeatureTable} table
 * @param {string} mode one of {@link FEATURE_READ_MODE}
 */
function scanRows(rows, table, mode) {
  const geometryTypes = []
  const keepGeometryObject = mode === FEATURE_READ_MODE.full
  const decode = keepGeometryObject || mode === FEATURE_READ_MODE.serialised
  const wantFeatures = decode || mode === FEATURE_READ_MODE.properties

  for (const row of rows) {
    const blob = row[table.geometryColumn]
    if (blob === null || blob === undefined) {
      continue
    }
    geometryTypes.push(getWkbType(blob))
    if (wantFeatures && !table.decodeFailure) {
      collectRow(row, blob, table, { decode, keepGeometryObject })
    }
  }

  table.geometryTypes = geometryTypes
}

/**
 * Collect one row at the requested depth: a decoded feature for the
 * geometry-bearing modes, attributes only for `properties`.
 *
 * @param {object} row
 * @param {Buffer} blob
 * @param {FeatureTable} table
 * @param {{ decode: boolean, keepGeometryObject: boolean }} depth
 */
function collectRow(row, blob, table, { decode, keepGeometryObject }) {
  if (decode) {
    collectFeature(row, blob, table, keepGeometryObject)
  } else {
    collectProperties(row, table)
  }
}

/**
 * @param {object} row
 * @param {Buffer} blob
 * @param {FeatureTable} table
 */
function collectFeature(row, blob, table, keepGeometryObject) {
  try {
    const feature = decodeFeature(row, blob, table, keepGeometryObject)
    if (feature) {
      table.features.push(feature)
    }
  } catch (err) {
    table.decodeFailure = err
  }
}

/**
 * The properties-only counterpart of {@link collectFeature}: the attribute
 * columns, and deliberately no geometry.
 *
 * The SRID check that {@link decodeFeature} performs is skipped along with the
 * decode, which is safe here because nothing downstream of a properties-only
 * read touches a coordinate — an unsupported SRID still surfaces from the `full`
 * read on the persistence path, before anything is written.
 *
 * @param {object} row
 * @param {FeatureTable} table
 */
function collectProperties(row, table) {
  table.features.push({
    type: 'Feature',
    properties: featureProperties(row, table.geometryColumn)
  })
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
 * @param {string} mode one of {@link FEATURE_READ_MODE}
 * @returns {FeatureTable}
 */
function readFeatureTable(db, tableName, mode) {
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

  // Heap is sampled either side of each stage so the evidence separates the two
  // costs this read carries: pulling the raw WKB blobs out of SQLite, and
  // expanding them into GeoJSON object graphs. They scale very differently —
  // the fetch tracks the file size, the decode multiplies it — and knowing the
  // split is what tells us whether batching the decode is worth the work.
  //
  // heapUsed moves under GC as well as under allocation, so a single delta is
  // indicative rather than exact, and a negative one just means a collection
  // landed mid-stage. Read these across several files, not off one line.
  const heapBefore = memoryUsageMb().heapUsedMb
  const fetchStart = perfNow()
  const rows = selectAllRows(db, table)
  const fetchMs = msSince(fetchStart)
  const heapAfterFetch = memoryUsageMb().heapUsedMb
  if (!rows) {
    return table
  }
  if (!tableColumnNames(db, tableName).includes(table.geometryColumn)) {
    table.selectFailure = new Error(`no such column: ${table.geometryColumn}`)
    return table
  }

  const scanStart = perfNow()
  scanRows(rows, table, mode)
  // Evidence (Item 2 — every feature and geometry is loaded synchronously): the
  // whole table is pulled into memory with .all(), then every blob is classified
  // (and, when decoding, unpacked to GeoJSON) in this synchronous walk.
  // better-sqlite3 has no async mode, so the event loop is blocked for
  // fetchMs + decodeMs together, and both grow with the row count.
  logPerf(logger, 'sync-feature-load', {
    table: tableName,
    rowCount: rows.length,
    featureCount: table.features.length,
    mode,
    fetchMs,
    decodeMs: msSince(scanStart),
    fetchHeapMb: heapAfterFetch - heapBefore,
    decodeHeapMb: memoryUsageMb().heapUsedMb - heapAfterFetch
  })
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
 * @param {{ mode?: string }} [options] `mode` is one of {@link FEATURE_READ_MODE}
 * @returns {{
 *   tables: Map<string, FeatureTable>,
 *   logicalTables: Map<string, string>,
 *   missingLayers: string[],
 *   tableNames: string[]
 * }}
 */
export function readFeatureTables(
  db,
  { mode = FEATURE_READ_MODE.classify } = {}
) {
  const tableNames = featureTableNames(db)
  const { logicalTables, missingLayers } = resolveLogicalTables(tableNames)
  // Only the layers that carry data are read at the requested mode; everything
  // else the gate looks at is classified, which is all it ever wanted.
  const dataTables =
    mode === FEATURE_READ_MODE.classify
      ? new Set()
      : new Set(logicalTables.values())

  const tables = new Map()
  for (const tableName of tableNames) {
    const isDataTable = dataTables.has(tableName)
    if (isDataTable || GATE_LAYER_KEYS.has(tableName.toLowerCase())) {
      tables.set(
        tableName.toLowerCase(),
        readFeatureTable(
          db,
          tableName,
          isDataTable ? mode : FEATURE_READ_MODE.classify
        )
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
