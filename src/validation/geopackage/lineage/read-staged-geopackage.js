// Read a staged GeoPackage — baseline and post-intervention as separate
// feature tables in one file — into a shape the lineage and reconciliation
// steps can use.
//
// Deliberately thin. It reuses the existing readGeoPackage feature decoding by
// going through the same sqlite/WKB path, and adds only the stage/type routing
// plus the lineage columns the staged model introduces.

import Database from 'better-sqlite3'
import { wkbToGeoJSON } from 'bng-library/gpkg-io'

import { EPSG_BNG } from '../geopackage-constants.js'
import { groupStagedTables, isStagedGeoPackage } from './staged-layer-names.js'

const GPKG_CONTENTS_FEATURES_DATA_TYPE = 'features'

/** Column carrying the feature's own reference, on every habitat table. */
const REF_COLUMNS = ['Habitat Ref']
/** Column naming the baseline feature a PI feature was derived from. */
const PARENT_COLUMNS = ['Parent Ref']
/** Hidden machine key the template gives every baseline feature. */
const FEATURE_UUID_COLUMNS = ['feature_uuid']
/** Hidden machine key naming a post-intervention row's baseline parent. */
const PARENT_UUID_COLUMNS = ['parent_uuid']
/** The parent's shape as WKT when the row was linked — see baseline-drift.js. */
const PARENT_GEOM_COLUMNS = ['parent_geom']

function firstPresent(row, candidates) {
  for (const key of candidates) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') {
      return String(value)
    }
  }
  return null
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {boolean} [postIntervention] true for a post-intervention table, whose
 *   `Habitat Ref` is also exposed as `piRef`
 */
function readTable(db, tableName, postIntervention = false) {
  const geomColumnRow = db
    .prepare(
      'SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?'
    )
    .get(tableName)
  if (!geomColumnRow?.column_name) {
    return []
  }
  const { column_name: geomColumn, srs_id: tableSrid } = geomColumnRow
  // The template writes British National Grid throughout; a table registered
  // without an srs_id (hand-built fixtures) is treated as 27700 rather than
  // being dropped, because every consumer downstream needs *a* SRID to carry.
  const srid = tableSrid ?? EPSG_BNG
  // Layer names contain spaces, so the identifier has to be quoted inline —
  // SQLite cannot bind object names as parameters.
  const quoted = `"${tableName.replaceAll('"', '""')}"`
  const rows = db.prepare(`SELECT * FROM ${quoted}`).all()
  return rows.map((row) => {
    const { [geomColumn]: blob, ...properties } = row
    const ref = firstPresent(properties, REF_COLUMNS)
    return {
      ref,
      piRef: postIntervention ? ref : null,
      parentRef: firstPresent(properties, PARENT_COLUMNS),
      featureUuid: firstPresent(properties, FEATURE_UUID_COLUMNS),
      parentUuid: firstPresent(properties, PARENT_UUID_COLUMNS),
      parentGeom: firstPresent(properties, PARENT_GEOM_COLUMNS),
      retentionCategory: properties['Retention Category'] ?? null,
      properties,
      geometry: blob ? wkbToGeoJSON(blob) : null,
      srid
    }
  })
}

/**
 * @param {string} filePath
 * @returns {{ staged: boolean, redline: object[], baseline: Record<string, object[]>, postIntervention: Record<string, object[]>, ignoredTables: string[] }}
 */
export function readStagedGeoPackage(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const tableNames = db
      .prepare(
        'SELECT table_name FROM gpkg_contents WHERE lower(CAST(data_type AS TEXT)) = ?'
      )
      .all(GPKG_CONTENTS_FEATURES_DATA_TYPE)
      .map((row) => row.table_name)

    const staged = isStagedGeoPackage(tableNames)
    const grouped = groupStagedTables(tableNames)

    const result = {
      staged,
      redline: [],
      baseline: {},
      postIntervention: {},
      ignoredTables: grouped.ignored
    }
    for (const table of grouped.redline) {
      result.redline.push(...readTable(db, table))
    }
    for (const [type, table] of Object.entries(grouped.baseline)) {
      result.baseline[type] = readTable(db, table)
    }
    for (const [type, table] of Object.entries(grouped.postIntervention)) {
      result.postIntervention[type] = readTable(db, table, true)
    }
    return result
  } finally {
    db.close()
  }
}
