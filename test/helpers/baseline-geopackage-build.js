import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

import {
  GPKG_APP_ID_GP10,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  EPSG_BNG
} from '../../src/validation/baseline/geopackage-constants.js'
import {
  GPKG_TEST_GEOMETRY_COLUMN_M,
  GPKG_TEST_GEOMETRY_COLUMN_Z,
  FULL_READ_LAYERS,
  LAYER_HABITATS,
  LAYER_RLB,
  createSystemTables,
  insertFeatureLayers,
  insertIllegalBaselineFeatureLayers,
  insertNonFeatureLayers,
  readTestLineStringWkb,
  readTestMultiPolygonWkb,
  readTestPointWkb,
  readTestPolygonWkb,
  wrapGpkgWkb
} from './baseline-geopackage-db.js'

/** Used when `buildBuffer()` is invoked with no arguments. */
const DEFAULT_BUILD_BUFFER_OPTIONS = {}

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
 * @param {string|null|undefined} [opts.rlbGeomColumnName]
 * @param {string|null|undefined} [opts.habitatsGeomColumnName]
 * @param {string[]} [opts.illegalFeatureLayers=[]]
 */
export function buildBuffer(opts = DEFAULT_BUILD_BUFFER_OPTIONS) {
  const {
    appId = 0,
    systemTables = false,
    featureLayers = [],
    nonFeatureLayers = [],
    layerFeatures = {},
    illegalFeatureLayers = [],
    rlbGeomColumnName,
    habitatsGeomColumnName
  } = opts
  const db = new Database(':memory:')
  db.pragma(`application_id = ${appId}`)

  if (systemTables) {
    createSystemTables(db)
    insertFeatureLayers(
      db,
      featureLayers,
      layerFeatures,
      rlbGeomColumnName,
      habitatsGeomColumnName
    )
    insertIllegalBaselineFeatureLayers(db, illegalFeatureLayers)
    insertNonFeatureLayers(db, nonFeatureLayers)
  }

  const buffer = Buffer.from(db.serialize())
  db.close()
  return buffer
}

/** GeoPackage buffer with all layers populated for `readBaselineGeoPackage` tests */
export function fullReadBuffer(layerFeaturesOverrides = {}) {
  return buildBuffer({
    appId: GPKG_APP_ID_GP10,
    systemTables: true,
    featureLayers: FULL_READ_LAYERS,
    layerFeatures: {
      [LAYER_RLB]: [wrapGpkgWkb(readTestPolygonWkb())],
      [LAYER_HABITATS]: [wrapGpkgWkb(readTestMultiPolygonWkb())],
      Hedgerows: [wrapGpkgWkb(readTestLineStringWkb())],
      Rivers: [wrapGpkgWkb(readTestLineStringWkb())],
      'Urban Trees': [wrapGpkgWkb(readTestPointWkb())],
      ...layerFeaturesOverrides
    }
  })
}

/** Single-row DB using an underscored RLB alias table name (resolver coverage). */
export function buildBufferWithRedLineBoundaryAliasTable() {
  const db = new Database(':memory:')
  db.pragma(`application_id = ${GPKG_APP_ID_GP10}`)
  createSystemTables(db)
  db.exec(
    'CREATE TABLE red_line_boundary (fid INTEGER NOT NULL PRIMARY KEY, geometry BLOB)'
  )
  db.prepare(
    `INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
     VALUES ('red_line_boundary', ?, 'rlb', ${EPSG_BNG})`
  ).run(GPKG_CONTENTS_FEATURES_DATA_TYPE)
  db.prepare(
    `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
     VALUES ('red_line_boundary', 'geometry', 'POLYGON', ${EPSG_BNG}, ?, ?)`
  ).run(GPKG_TEST_GEOMETRY_COLUMN_Z, GPKG_TEST_GEOMETRY_COLUMN_M)
  db.prepare('INSERT INTO red_line_boundary (fid, geometry) VALUES (1, ?)').run(
    wrapGpkgWkb(readTestPolygonWkb())
  )
  const buf = Buffer.from(db.serialize())
  db.close()
  return buf
}

// ---------------------------------------------------------------------------
// Temp file helpers (async — require node:fs/promises)
// ---------------------------------------------------------------------------

export async function withTempGpkgFile(buffer, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'baseline-gpkg-read-'))
  const filePath = join(dir, 'baseline.gpkg')
  await writeFile(filePath, buffer)
  try {
    return await fn(filePath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function mutateSerializedBuffer(buffer, fn) {
  const db = new Database(buffer)
  try {
    fn(db)
    return Buffer.from(db.serialize())
  } finally {
    db.close()
  }
}
