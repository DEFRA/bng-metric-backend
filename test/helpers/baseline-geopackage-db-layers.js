import Database from 'better-sqlite3'

import {
  EPSG_BNG,
  GPKG_APP_ID_GP10,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  RLB_LYR,
  HABITATS_LYR
} from '../../src/validation/baseline/geopackage-constants.js'

import { makePolygon } from './baseline-geopackage-db-blobs.js'
import { isGeometrySqliteColumnType } from '../../src/validation/baseline/geopackage-internals-sqlite.js'
import {
  createLayerTableDDL,
  createSystemTables,
  quoteIdent
} from './baseline-geopackage-db-ddl.js'
import { baselineSchema } from './baseline-geopackage-db-fixtures.js'

function geometryRegistrationForLayer(
  lowerTable,
  defaultColName,
  rlbGeomColumnName,
  habitatsGeomColumnName
) {
  const overrideByTable = {
    [RLB_LYR]: rlbGeomColumnName,
    [HABITATS_LYR]: habitatsGeomColumnName
  }
  const overrideColName = overrideByTable[lowerTable]

  if (overrideColName === undefined) {
    return { registerGeom: true, registeredColName: defaultColName }
  }
  if (overrideColName === null) {
    return { registerGeom: false, registeredColName: defaultColName }
  }
  if (typeof overrideColName === 'string') {
    return { registerGeom: true, registeredColName: overrideColName }
  }
  return { registerGeom: true, registeredColName: defaultColName }
}

function createLayerTableDDLWithGeomColumnName(layerDef, geomColumnName) {
  const columns = layerDef.columns.map((col) =>
    isGeometrySqliteColumnType(col.sqliteType)
      ? { ...col, name: geomColumnName }
      : col
  )
  return createLayerTableDDL({ ...layerDef, columns })
}

function insertLayerGeometryRows(
  db,
  layerDef,
  layerKey,
  layerFeatures,
  geomColumnName
) {
  const geoms = layerFeatures[layerKey] ??
    layerFeatures[layerDef.tableName] ?? [makePolygon()]

  const gc = quoteIdent(geomColumnName)
  const tn = quoteIdent(layerDef.tableName)
  for (const geom of geoms) {
    db.prepare(`INSERT INTO ${tn} (${gc}) VALUES (?)`).run(geom)
  }
}

function registerOneFeatureLayer(
  db,
  layerKey,
  layerFeatures,
  rlbGeomColumnName,
  habitatsGeomColumnName
) {
  const layerDef = baselineSchema.layers.find(
    (l) => l.tableName.toLowerCase() === layerKey.toLowerCase()
  )
  if (!layerDef) {
    throw new Error(
      `Test layer "${layerKey}" must exist in baseline-template.schema.json`
    )
  }

  const lowerTable = layerDef.tableName.toLowerCase()
  const { registerGeom, registeredColName } = geometryRegistrationForLayer(
    lowerTable,
    layerDef.geometryColumn.name,
    rlbGeomColumnName,
    habitatsGeomColumnName
  )

  db.exec(createLayerTableDDLWithGeomColumnName(layerDef, registeredColName))

  db.prepare(
    `INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
       VALUES (?, ?, ?, ?)`
  ).run(
    layerDef.tableName,
    GPKG_CONTENTS_FEATURES_DATA_TYPE,
    layerDef.tableName,
    layerDef.srsId
  )

  if (registerGeom) {
    db.prepare(
      `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      layerDef.tableName,
      registeredColName,
      layerDef.geometryColumn.geometryType,
      layerDef.srsId,
      GPKG_TEST_GEOMETRY_COLUMN_Z,
      GPKG_TEST_GEOMETRY_COLUMN_M
    )
  }

  insertLayerGeometryRows(
    db,
    layerDef,
    layerKey,
    layerFeatures,
    registeredColName
  )
}

export function insertFeatureLayers(
  db,
  featureLayers,
  layerFeatures,
  rlbGeomColumnName,
  habitatsGeomColumnName
) {
  for (const layerKey of featureLayers) {
    registerOneFeatureLayer(
      db,
      layerKey,
      layerFeatures,
      rlbGeomColumnName,
      habitatsGeomColumnName
    )
  }
}

export const GPKG_TEST_GEOMETRY_COLUMN_Z = 0
export const GPKG_TEST_GEOMETRY_COLUMN_M = 0

export function openMemoryGp10WithSystemTables() {
  const db = new Database(':memory:')
  db.pragma(`application_id = ${GPKG_APP_ID_GP10}`)
  createSystemTables(db)
  return db
}

export function openMinimalGpkgContentsStub() {
  const db = new Database(':memory:')
  db.exec(
    'CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT)'
  )
  return db
}

export function insertGpkgFeatureContentsRow(db, tableName, srsId) {
  db.prepare(
    `INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
       VALUES (?, ?, ?, ?)`
  ).run(tableName, GPKG_CONTENTS_FEATURES_DATA_TYPE, tableName, srsId)
}

export function insertGpkgGeometryColumnsRow(
  db,
  tableName,
  columnName,
  geometryTypeName,
  srsId
) {
  db.prepare(
    `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
       VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    tableName,
    columnName,
    geometryTypeName,
    srsId,
    GPKG_TEST_GEOMETRY_COLUMN_Z,
    GPKG_TEST_GEOMETRY_COLUMN_M
  )
}

export function registerBareFeatureBlobLayer(db, opts) {
  const {
    tableName,
    tableGeomColumnName = 'geom',
    regColumnName,
    geometryTypeName,
    srsId = EPSG_BNG
  } = opts
  insertGpkgFeatureContentsRow(db, tableName, srsId)
  const qGeom = quoteIdent(tableGeomColumnName)
  const qTable = quoteIdent(tableName)
  db.exec(
    `CREATE TABLE ${qTable} (fid INTEGER NOT NULL PRIMARY KEY, ${qGeom} BLOB)`
  )
  insertGpkgGeometryColumnsRow(
    db,
    tableName,
    regColumnName,
    geometryTypeName,
    srsId
  )
}

export function insertIllegalBaselineFeatureLayers(db, names) {
  for (const name of names) {
    const q = quoteIdent(name)
    db.exec(`CREATE TABLE ${q} (id INTEGER PRIMARY KEY)`)
    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
       VALUES (?, ?, ?, ?)`
    ).run(name, GPKG_CONTENTS_FEATURES_DATA_TYPE, name, EPSG_BNG)
  }
}

export function insertNonFeatureLayers(db, nonFeatureLayers) {
  for (const layer of nonFeatureLayers) {
    db.exec(`CREATE TABLE "${layer}" (id INTEGER PRIMARY KEY)`)
    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier)
       VALUES (?, 'tiles', ?)`
    ).run(layer, layer)
  }
}
