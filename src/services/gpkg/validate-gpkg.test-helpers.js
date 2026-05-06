import Database from 'better-sqlite3'

const { ERROR_CODES } = await import('../../validation/baseline/errors.js')

// GeoPackage application IDs
export const GP10_APP_ID = 0x47503130 // 1196437808 — GeoPackage 1.0
export const GPKG_APP_ID = 0x47504b47 // 1196444487 — GeoPackage 1.2.1+

// Required layer names
export const LAYER_RLB = 'Red Line Boundary'
export const LAYER_HABITATS = 'Habitats'
export const ALL_LAYERS = [LAYER_RLB, LAYER_HABITATS]

export const missingLayerError = (name) => ({
  code: ERROR_CODES.GPKG_MISSING_LAYER,
  message: `Missing required feature layer in GeoPackage: ${name}`
})
export const ERR_ZERO_RLB = {
  code: ERROR_CODES.GPKG_RLB_NO_POLYGON,
  message: 'Zero red line boundaries in GeoPackage (expecting one)'
}
export const ERR_UNREADABLE_RLB = {
  code: ERROR_CODES.GPKG_RLB_UNREADABLE_GEOMETRY,
  message: 'Red Line Boundary contains unreadable geometry'
}
export const ERR_ZERO_HABITATS = {
  code: ERROR_CODES.NO_HABITAT_AREAS,
  message: 'Zero area habitat parcels in GeoPackage (expecting at least one)'
}
export const ERR_UNREADABLE_HABITATS = {
  code: ERROR_CODES.GPKG_HABITATS_UNREADABLE_GEOMETRY,
  message: 'Habitats contains unreadable geometry'
}

// GeoPackageBinary magic bytes ('G', 'P')
const GPKG_MAGIC_BYTE_G = 0x47
const GPKG_MAGIC_BYTE_P = 0x50

// WKB geometry type codes
const WKB_TYPE_POLYGON = 3
const WKB_TYPE_LINE_STRING = 2
const WKB_TYPE_POINT = 1

// Minimum size of a WKB payload (1-byte endian + 4-byte type)
const WKB_HEADER_BYTES = 5

/**
 * Build a minimal GeoPackageBinary blob wrapping a WKB geometry.
 * Header: magic (GP), version (0), flags (little-endian, no envelope), srs_id (0).
 */
function makeGpkgBlob(wkbType) {
  const header = Buffer.from([
    GPKG_MAGIC_BYTE_G,
    GPKG_MAGIC_BYTE_P,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00
  ])
  const wkb = Buffer.allocUnsafe(WKB_HEADER_BYTES)
  wkb.writeUInt8(1, 0) // little-endian
  wkb.writeUInt32LE(wkbType, 1)
  return Buffer.concat([header, wkb])
}

export const makePolygon = () => makeGpkgBlob(WKB_TYPE_POLYGON)
export const makeLineString = () => makeGpkgBlob(WKB_TYPE_LINE_STRING)
export const makePoint = () => makeGpkgBlob(WKB_TYPE_POINT)

// too short to parse — only the 2-byte magic prefix
export const makeCorruptBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P])

// Envelope indicator 5 is out of range (GPKG_ENVELOPE_SIZES only covers 0–4)
export const makeInvalidEnvelopeBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00]) // prettier-ignore

// Envelope indicator 1 signals a 32-byte envelope, but the blob ends at byte 8,
// leaving no room for the WKB payload (needs at least 45 bytes total)
export const makeTruncatedEnvelopeBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]) // prettier-ignore

/**
 * Build a SQLite database in-memory, optionally configure it as a
 * GeoPackage, then serialize it to a Buffer for use with validateGpkg.
 *
 * @param {object} [opts]
 * @param {number}   [opts.appId=0]
 * @param {boolean}  [opts.systemTables=false]
 * @param {string[]} [opts.featureLayers=[]]
 * @param {string[]} [opts.nonFeatureLayers=[]]
 * @param {Record<string, Buffer[]>} [opts.layerFeatures={}]
 *   Map of layer name to array of geometry blobs to insert.
 *   Defaults to one polygon per layer when not specified.
 * @param {Record<string, string|null>} [opts.geomColumnNames={}]
 *   Map of lower-cased layer name to the geometry column name registered in
 *   gpkg_geometry_columns. Set the value to null to omit the row entirely.
 *   Layers not in the map default to 'geom'.
 */
export function buildBuffer({
  appId = 0,
  systemTables = false,
  featureLayers = [],
  nonFeatureLayers = [],
  layerFeatures = {},
  geomColumnNames = {}
} = {}) {
  const db = new Database(':memory:')
  db.pragma(`application_id = ${appId}`)

  if (systemTables) {
    createSystemTables(db)
    insertFeatureLayers(db, featureLayers, layerFeatures, geomColumnNames)
    insertNonFeatureLayers(db, nonFeatureLayers)
  }

  const buffer = Buffer.from(db.serialize())
  db.close()
  return buffer
}

function createSystemTables(db) {
  db.exec(`
    CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL,
      description TEXT
    )
  `)
  db.exec(`
    CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT UNIQUE,
      description TEXT DEFAULT '',
      last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      min_x REAL, min_y REAL, max_x REAL, max_y REAL,
      srs_id INTEGER
    )
  `)
  db.exec(`
    CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL,
      m TINYINT NOT NULL,
      CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name)
    )
  `)
}

function insertFeatureLayers(
  db,
  featureLayers,
  layerFeatures,
  geomColumnNames
) {
  for (const layer of featureLayers) {
    db.exec(`CREATE TABLE "${layer}" (id INTEGER PRIMARY KEY, geom BLOB)`)
    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier)
       VALUES (?, 'features', ?)`
    ).run(layer, layer)
    const key = layer.toLowerCase()
    const colName = key in geomColumnNames ? geomColumnNames[key] : 'geom'
    if (colName !== null) {
      db.prepare(
        `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
         VALUES (?, ?, 'GEOMETRY', 4326, 0, 0)`
      ).run(layer, colName)
    }
    const geoms = layerFeatures[layer] ?? [makePolygon()]
    for (let i = 0; i < geoms.length; i++) {
      db.prepare(`INSERT INTO "${layer}" (id, geom) VALUES (?, ?)`).run(
        i + 1,
        geoms[i]
      )
    }
  }
}

function insertNonFeatureLayers(db, nonFeatureLayers) {
  for (const layer of nonFeatureLayers) {
    db.exec(`CREATE TABLE "${layer}" (id INTEGER PRIMARY KEY)`)
    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier)
       VALUES (?, 'tiles', ?)`
    ).run(layer, layer)
  }
}
