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

/** Column names carrying the feature's own reference, in preference order. */
const REF_COLUMNS = ['PI Ref', 'Parcel Ref', 'Tree Ref', 'ref']
/** Column naming the baseline parcel a PI feature was derived from. */
const PARENT_COLUMNS = ['Parent Ref', 'parent_ref']
/** Hidden machine keys stamped by the template — see geometry-checksum.js. */
const FEATURE_UUID_COLUMNS = ['feature_uuid']
const PARENT_UUID_COLUMNS = ['parent_uuid']
const PARENT_CHECKSUM_COLUMNS = ['parent_checksum']

function firstPresent(row, candidates) {
  for (const key of candidates) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') {
      return String(value)
    }
  }
  return null
}

function readTable(db, tableName) {
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
    return {
      ref: firstPresent(properties, REF_COLUMNS),
      piRef: firstPresent(properties, ['PI Ref']),
      parentRef: firstPresent(properties, PARENT_COLUMNS),
      featureUuid: firstPresent(properties, FEATURE_UUID_COLUMNS),
      parentUuid: firstPresent(properties, PARENT_UUID_COLUMNS),
      parentChecksum: firstPresent(properties, PARENT_CHECKSUM_COLUMNS),
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
      result.postIntervention[type] = readTable(db, table)
    }
    return result
  } finally {
    db.close()
  }
}
