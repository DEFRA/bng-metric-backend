import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

import {
  GPKG_APP_ID_GP10,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  EPSG_BNG
} from '../../src/validation/geopackage/geopackage-constants.js'
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
} from './gpkg-db.js'

/** Used when `buildBuffer()` is invoked with no arguments. */
const DEFAULT_BUILD_BUFFER_OPTIONS = {}

/**
 * Configure an already-open SQLite database as a GeoPackage: sets the
 * application_id and, when requested, creates the GeoPackage system tables
 * and populates the requested feature/non-feature layers.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {number}   [opts.appId=0]
 * @param {boolean}  [opts.systemTables=false]
 * @param {string[]} [opts.featureLayers=[]]
 * @param {string[]} [opts.nonFeatureLayers=[]]
 * @param {Record<string, Buffer[]>} [opts.layerFeatures={}]
 * @param {string|null|undefined} [opts.rlbGeomColumnName]
 * @param {string|null|undefined} [opts.habitatsGeomColumnName]
 * @param {string[]} [opts.illegalFeatureLayers=[]]
 */
function populateGpkgDb(db, opts) {
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
}

/**
 * Build a SQLite database in-memory, optionally configure it as a
 * GeoPackage, then serialize it to a Buffer for use with validateGpkg.
 *
 * @param {object} [opts] - See populateGpkgDb() for option descriptions.
 * @returns {Buffer}
 */
export function buildBuffer(opts = DEFAULT_BUILD_BUFFER_OPTIONS) {
  const db = new Database(':memory:')
  populateGpkgDb(db, opts)
  const buffer = Buffer.from(db.serialize())
  db.close()
  return buffer
}

/**
 * Build a GeoPackage the same way as buildBuffer(), but as a real file-backed
 * database switched into WAL journal mode and checkpointed, then read back as
 * a Buffer — mirroring a GeoPackage last saved by desktop GIS software with
 * WAL mode enabled and uploaded without its -wal/-shm sidecar files.
 *
 * @param {object} [opts] - Same options as buildBuffer().
 * @returns {Buffer}
 */
export function buildWalModeBuffer(opts = DEFAULT_BUILD_BUFFER_OPTIONS) {
  const dir = mkdtempSync(join(tmpdir(), 'gpkg-wal-fixture-'))
  const filePath = join(dir, 'wal-mode.gpkg')
  try {
    const db = new Database(filePath)
    try {
      populateGpkgDb(db, opts)
      db.pragma('journal_mode = WAL')
      db.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
    return readFileSync(filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** GeoPackage buffer with all layers populated for `readGeoPackage` tests */
export function fullReadBuffer(layerFeaturesOverrides = {}) {
  return buildBuffer(fullReadBuildOptions(layerFeaturesOverrides))
}

/** Options shared by fullReadBuffer() and walModeFullReadBuffer(). */
function fullReadBuildOptions(layerFeaturesOverrides) {
  return {
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
  }
}

/** As fullReadBuffer(), but last saved in WAL journal mode. */
export function walModeFullReadBuffer(layerFeaturesOverrides = {}) {
  return buildWalModeBuffer(fullReadBuildOptions(layerFeaturesOverrides))
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
