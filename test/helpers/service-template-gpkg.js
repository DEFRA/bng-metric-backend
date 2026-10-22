import Database from 'better-sqlite3'
import {
  TEMPLATE_SCHEMA,
  TEMPLATE_SOURCE,
  versionRecordText
} from 'bng-library/bng-service'

import { GPKG_APP_ID_GPKG } from '../../src/validation/geopackage/geopackage-constants.js'
import {
  readTestLineStringWkb,
  readTestPointWkb,
  readTestPolygonWkb,
  wrapGpkgWkb
} from './gpkg-db-blobs.js'
import { createSystemTables, quoteIdent } from './gpkg-db-ddl.js'

/**
 * Build a BNG Service template GeoPackage in code, with its version record.
 *
 * Built from bng-library's copy of the template rather than from the backend's
 * own reading of it, so a mistake in the backend's schema shows up as a failing
 * test instead of being built into the fixtures. Tables are empty unless the
 * caller gives them rows: the format gate never reads a feature, the reader
 * does. {@link populatedBaselineRows} gives one valid row per Baseline table.
 *
 * The legacy helpers (gpkg-build.js) stay for the flag-off tests.
 */

const BNG_SRS_ID = 27700
const WGS84_SRS_ID = 4326
const FEATURES = 'features'
const GEOPACKAGE_SCOPE = 'geopackage'

const SPATIAL_REF_SYS = [
  [
    'British National Grid',
    BNG_SRS_ID,
    'EPSG',
    BNG_SRS_ID,
    'PROJCS["OSGB 1936 / British National Grid"]'
  ],
  ['WGS 84', WGS84_SRS_ID, 'EPSG', WGS84_SRS_ID, 'GEOGCS["WGS 84"]']
]

/** A geometry of each type the template uses, in British National Grid. */
const TEST_GEOMETRY_WKB = {
  POLYGON: readTestPolygonWkb,
  LINESTRING: readTestLineStringWkb,
  POINT: readTestPointWkb
}

const AREA_HABITATS_BASELINE = 'Area Habitats Baseline'
const HEDGEROWS_BASELINE = 'Hedgerows Baseline'
const WATERCOURSES_BASELINE = 'Watercourses Baseline'
const RED_LINE_BOUNDARY = 'Red Line Boundary'

/**
 * One valid row in each Baseline table and the Red Line Boundary, with values
 * the template offers and the service accepts (from the harness corpus's
 * valid/plain-site.gpkg). Each habitat row carries its own feature_uuid.
 *
 * @returns {Record<string, object[]>} rows by table, as `rows` takes them
 */
export function populatedBaselineRows() {
  return {
    [RED_LINE_BOUNDARY]: [{ 'Site Name': 'Oakwood Regional Development' }],
    [AREA_HABITATS_BASELINE]: [
      {
        'Habitat Ref': 'H001',
        'Baseline Broad Habitat Type': 'Grassland',
        'Baseline Habitat Type': 'Other lowland acid grassland',
        'Baseline Distinctiveness': 'Medium',
        'Baseline Condition': 'Fairly Poor',
        'Baseline Strategic Significance': 'Low',
        'Irreplaceable Habitat': 'No',
        Area: 1,
        feature_uuid: 'de9d1450-90f7-584a-9710-edf7ec189de4'
      }
    ],
    [HEDGEROWS_BASELINE]: [
      {
        'Habitat Ref': 'HG001',
        'Baseline Hedge Type': 'Line of trees - associated with bank or ditch',
        'Baseline Distinctiveness': 'Low',
        'Baseline Condition': 'Poor',
        'Baseline Strategic Significance': 'Low',
        Length: 1,
        feature_uuid: '058245bc-2cce-58fa-9b8f-de304545f380'
      }
    ],
    [WATERCOURSES_BASELINE]: [
      {
        'Habitat Ref': 'R001',
        'Baseline River Type': 'Culvert',
        'Baseline Distinctiveness': 'Low',
        'Baseline Condition': 'Poor',
        'Baseline Strategic Significance': 'Low',
        'Baseline Encroachment into Watercourse': 'N/A - Culvert',
        'Baseline Encroachment into riparian zone': 'N/A - Culvert',
        Length: 1,
        feature_uuid: '0c55b68c-6afb-59c6-9453-618d89539d76'
      }
    ]
  }
}

/**
 * Insert rows into a built table. A row's geometry is a test shape of the
 * table's geometry type unless the row gives its own `geom` blob.
 */
function insertRows(db, table, rows) {
  for (const { geom, ...values } of rows) {
    const columns = [table.geometryColumn, ...Object.keys(values)]
    const blob = geom ?? wrapGpkgWkb(TEST_GEOMETRY_WKB[table.geometryType]())
    db.prepare(
      `INSERT INTO ${quoteIdent(table.name)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).run(blob, ...Object.values(values))
  }
}

function createMetadataTables(db) {
  db.exec(`
    CREATE TABLE gpkg_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      md_scope TEXT NOT NULL DEFAULT 'dataset',
      md_standard_uri TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'text/xml',
      metadata TEXT NOT NULL DEFAULT ''
    )
  `)
  db.exec(`
    CREATE TABLE gpkg_metadata_reference (
      reference_scope TEXT NOT NULL,
      table_name TEXT,
      column_name TEXT,
      row_id_value INTEGER,
      timestamp DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      md_file_id INTEGER NOT NULL,
      md_parent_id INTEGER
    )
  `)
}

function insertVersionRecords(db, records, recordScope, standardUri) {
  const insertRecord = db.prepare(
    "INSERT INTO gpkg_metadata (md_scope, md_standard_uri, mime_type, metadata) VALUES ('dataset', ?, 'application/json', ?)"
  )
  const insertReference = db.prepare(
    'INSERT INTO gpkg_metadata_reference (reference_scope, md_file_id) VALUES (?, ?)'
  )
  for (const text of records) {
    const { lastInsertRowid } = insertRecord.run(standardUri, text)
    if (recordScope) {
      insertReference.run(recordScope, lastInsertRowid)
    }
  }
}

/**
 * One template table as it would be built, after any of the caller's edits.
 */
function tableDefinition(table, edits) {
  const dropped = new Set(edits.dropColumns?.[table.name] ?? [])
  const renamed = edits.renameColumns?.[table.name] ?? {}
  const retyped = edits.columnTypes?.[table.name] ?? {}
  return {
    name: table.name,
    geometryColumn:
      edits.geometryColumnNames?.[table.name] ?? table.geometryColumn,
    geometryType: edits.geometryTypes?.[table.name] ?? table.geometryType,
    srsId: edits.srsIds?.[table.name] ?? table.srsId,
    registerGeometry: !(edits.unregisteredGeometry ?? []).includes(table.name),
    columns: table.columns
      .filter((column) => !dropped.has(column.name))
      .map((column) => ({
        name: renamed[column.name] ?? column.name,
        type: retyped[column.name] ?? column.type
      }))
  }
}

function createTemplateTable(db, table) {
  const columns = [
    'fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL',
    `${quoteIdent(table.geometryColumn)} ${table.geometryType}`,
    ...table.columns.map(
      (column) => `${quoteIdent(column.name)} ${column.type}`
    )
  ]
  db.exec(`CREATE TABLE ${quoteIdent(table.name)} (${columns.join(', ')})`)
  db.prepare(
    'INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES (?, ?, ?, ?)'
  ).run(table.name, FEATURES, table.name, table.srsId)
  if (table.registerGeometry) {
    db.prepare(
      'INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m) VALUES (?, ?, ?, ?, 0, 0)'
    ).run(table.name, table.geometryColumn, table.geometryType, table.srsId)
  }
}

/**
 * @param {object} [options]
 * @param {string[]} [options.records] version record texts, one row each;
 *   `[]` for a file with none. Defaults to the one record the template writes.
 * @param {string|null} [options.recordScope] the reference scope each record
 *   is given; null for a record with no reference at all
 * @param {string} [options.standardUri] the records' md_standard_uri
 * @param {string[]} [options.omitTables] template tables left out
 * @param {Record<string, string[]>} [options.dropColumns] by table
 * @param {Record<string, Record<string, string>>} [options.renameColumns] by table, old → new
 * @param {Record<string, Record<string, string>>} [options.columnTypes] by table, column → type
 * @param {Record<string, string>} [options.geometryTypes] by table
 * @param {Record<string, string>} [options.geometryColumnNames] by table
 * @param {Record<string, number>} [options.srsIds] by table
 * @param {string[]} [options.unregisteredGeometry] tables with no gpkg_geometry_columns row
 * @param {string[]} [options.extraFeatureTables] feature tables the template does not have
 * @param {Record<string, object[]>} [options.rows] rows by table, each an
 *   object of column values, with an optional `geom` blob
 * @returns {Buffer}
 */
export function buildServiceTemplateBuffer(options = {}) {
  const {
    records = [versionRecordText()],
    recordScope = GEOPACKAGE_SCOPE,
    standardUri = TEMPLATE_SOURCE.metadataUri,
    omitTables = [],
    extraFeatureTables = [],
    rows = {}
  } = options

  const db = new Database(':memory:')
  try {
    db.pragma(`application_id = ${GPKG_APP_ID_GPKG}`)
    createSystemTables(db)
    const insertSrs = db.prepare(
      'INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition) VALUES (?, ?, ?, ?, ?)'
    )
    for (const row of SPATIAL_REF_SYS) {
      insertSrs.run(...row)
    }
    createMetadataTables(db)
    insertVersionRecords(db, records, recordScope, standardUri)

    for (const table of TEMPLATE_SCHEMA.tables) {
      if (!omitTables.includes(table.name)) {
        const definition = tableDefinition(table, options)
        createTemplateTable(db, definition)
        insertRows(db, definition, rows[table.name] ?? [])
      }
    }
    for (const name of extraFeatureTables) {
      createTemplateTable(db, {
        name,
        geometryColumn: 'geom',
        geometryType: 'POLYGON',
        srsId: BNG_SRS_ID,
        registerGeometry: true,
        columns: []
      })
    }
    return Buffer.from(db.serialize())
  } finally {
    db.close()
  }
}
