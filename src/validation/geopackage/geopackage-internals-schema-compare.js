import { ERROR_CODES, makeError } from './errors.js'
import {
  RLB_LYR,
  HABITATS_LYR,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  EXPECTED_GEOMETRY_COLUMN_COUNT
} from './geopackage-constants.js'
import { compareBaselineLayerSrs } from './geopackage-internals-schema-compare-srs.js'
import { compareLayerTableColumnsToSchema } from './geopackage-internals-schema-compare-columns.js'
import { SAFE_SQL_IDENTIFIER } from './geopackage-internals-sqlite.js'

export {
  compareDefinedColumnsToSchema,
  pragmaTableInfoByLowerName
} from './geopackage-internals-schema-compare-columns.js'

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {{
 *   lowerToActualTable: Map<string, string>,
 *   lowerToContentMeta: Map<string, { data_type: string, srs_id: unknown }>,
 *   uploadedFeatureLowerKeys: Set<string>
 * }}
 */
function indexFeatureLayersFromContents(db) {
  const rows = db
    .prepare(
      `SELECT lower(table_name) AS lower_key,
              table_name AS actual_table_name,
              CAST(data_type AS TEXT) AS data_type,
              srs_id AS srs_raw
         FROM gpkg_contents
        WHERE lower(CAST(data_type AS TEXT)) = ?`
    )
    .all(GPKG_CONTENTS_FEATURES_DATA_TYPE)

  /** @type {Map<string, string>} */
  const lowerToActualTable = new Map()
  /** @type {Map<string, { data_type: string, srs_id: unknown }>} */
  const lowerToContentMeta = new Map()
  /** @type {Set<string>} */
  const uploadedFeatureLowerKeys = new Set()

  for (const row of rows) {
    uploadedFeatureLowerKeys.add(row.lower_key)
    lowerToActualTable.set(row.lower_key, row.actual_table_name)
    lowerToContentMeta.set(row.lower_key, {
      data_type: row.data_type,
      srs_id: row.srs_raw
    })
  }

  return { lowerToActualTable, lowerToContentMeta, uploadedFeatureLowerKeys }
}

/**
 * @param {{ layers: Array<{ tableName: string }> }} schema
 */
function indexSchemaLayersByLowerName(schema) {
  /** @type {Map<string, unknown>} */
  const schemaByLower = new Map()
  for (const layerDef of schema.layers) {
    schemaByLower.set(layerDef.tableName.toLowerCase(), layerDef)
  }
  return schemaByLower
}

/**
 * @param {Set<string>} uploadedFeatureLowerKeys
 * @param {Map<string, unknown>} schemaByLower
 * @param {Map<string, string>} lowerToActualTable
 * @param {string[]} errors
 */
function reportUnexpectedFeatureLayers(
  uploadedFeatureLowerKeys,
  schemaByLower,
  lowerToActualTable,
  errors
) {
  for (const lowerKey of uploadedFeatureLowerKeys) {
    if (!schemaByLower.has(lowerKey)) {
      // lowerToActualTable is built from the same SQL result set as uploadedFeatureLowerKeys,
      // so get() will always find a value. The fallback to lowerKey is a pure safety net.
      /* v8 ignore next 1 */
      const shown = lowerToActualTable.get(lowerKey) ?? lowerKey
      errors.push(
        makeError(
          ERROR_CODES.GPKG_UNEXPECTED_FEATURE_LAYER,
          `Unexpected feature layer "${shown}" — not listed in baseline template schema`
        )
      )
    }
  }
}

/**
 * Compare `gpkg_contents.data_type` to the baseline template (SRS validated in `compareBaselineLayerSrs`).
 * @param {{ dataType: string, srsId: number|string }} layerDef
 * @param {string} actualTable
 * @param {{ data_type: string, srs_id: unknown } | undefined} contentMeta
 * @param {string[]} errors
 */
export function compareGpkgContentsToLayerSchema(
  layerDef,
  actualTable,
  contentMeta,
  errors
) {
  if (
    contentMeta &&
    String(contentMeta.data_type).trim().toLowerCase() !==
      layerDef.dataType.trim().toLowerCase()
  ) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_CONTENTS_DATA_TYPE,
        `Layer "${actualTable}" baseline mismatch: expected data_type "${layerDef.dataType}" in gpkg_contents but found "${contentMeta.data_type}"`
      )
    )
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} lowerTable
 * @returns {Array<{ column_name: string, geometry_type_name: string, geom_srs_raw: unknown }>}
 */
function getGeometryColumnsRows(db, lowerTable) {
  return db
    .prepare(
      `SELECT column_name, geometry_type_name, srs_id AS geom_srs_raw
         FROM gpkg_geometry_columns
        WHERE lower(table_name) = ?`
    )
    .all(lowerTable)
}

/**
 * Compare gpkg_geometry_columns registration (excluding srs_id — see `compareBaselineLayerSrs`).
 * Geometry column names are not matched to the baseline template; only syntactic validity and type.
 *
 * @param {{ tableName: string, geometryColumn: { name: string, geometryType: string }, srsId: number|string }} layerDef
 * @param {string} actualTable
 * @param {{ column_name: string, geometry_type_name: string, geom_srs_raw: unknown }} geomRow
 * @param {string[]} errors
 */
export function compareGeometryRegistrationRow(
  layerDef,
  actualTable,
  geomRow,
  errors
) {
  const expectedGeomType = layerDef.geometryColumn.geometryType

  if (!SAFE_SQL_IDENTIFIER.test(geomRow.column_name)) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME,
        `Layer "${actualTable}" geometry column "${geomRow.column_name}" has an invalid name in gpkg_geometry_columns`
      )
    )
    // Intentionally fall through: the geometry-type check below is independent and
    // may emit a second error. The column name appears only in the message above
    // (display only, never used in SQL), so there is no injection risk.
  }

  if (
    String(geomRow.geometry_type_name).toUpperCase() !==
    String(expectedGeomType).toUpperCase()
  ) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_GEOMETRY_TYPE_NAME,
        `Layer "${actualTable}" baseline mismatch: expected geometry type "${expectedGeomType}" in gpkg_geometry_columns but found "${geomRow.geometry_type_name}"`
      )
    )
  }
}

/**
 * @param {string} lowerTable
 * @param {string} actualTable
 * @param {string[]} errors
 */
function reportMissingGeometryRegistrationError(
  lowerTable,
  actualTable,
  errors
) {
  if (lowerTable === RLB_LYR) {
    // Red Line Boundary: GPKG_RLB_NO_GEOMETRY_COLUMN from validateRedLineBoundary
  } else if (lowerTable === HABITATS_LYR) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_HABITATS_NO_GEOMETRY_COLUMN,
        'Habitats layer has no registered geometry column in gpkg_geometry_columns'
      )
    )
  } else {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_GEOMETRY_REGISTRATION_MISSING,
        `Layer "${actualTable}" baseline mismatch: no geometry column registered in gpkg_geometry_columns`
      )
    )
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ geometryColumn: { name: string }, tableName: string, srsId: number|string }} layerDef
 * @param {string} lowerTable
 * @param {string} actualTable
 * @param {{ data_type: string, srs_id: unknown } | undefined} contentMeta
 * @param {string[]} errors
 */
export function compareOneLayerToBaselineSchema(
  db,
  layerDef,
  lowerTable,
  actualTable,
  contentMeta,
  errors
) {
  compareGpkgContentsToLayerSchema(layerDef, actualTable, contentMeta, errors)

  const geomRows = getGeometryColumnsRows(db, lowerTable)

  if (geomRows.length === 0) {
    compareBaselineLayerSrs(layerDef, actualTable, contentMeta, null, errors)
    reportMissingGeometryRegistrationError(lowerTable, actualTable, errors)
  } else if (geomRows.length > EXPECTED_GEOMETRY_COLUMN_COUNT) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_MULTIPLE_GEOMETRY_COLUMNS,
        `Layer "${actualTable}" baseline mismatch: expected exactly one geometry column in gpkg_geometry_columns but found ${geomRows.length}`
      )
    )
  } else {
    const geomRow = geomRows[0]

    compareBaselineLayerSrs(layerDef, actualTable, contentMeta, geomRow, errors)

    compareGeometryRegistrationRow(layerDef, actualTable, geomRow, errors)

    compareLayerTableColumnsToSchema(db, layerDef, actualTable, geomRow, errors)
  }
}

/**
 * Uploaded feature layers must match gpkg-template.schema.json columns, crs, geometry.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ layers: Array<{ tableName: string }> }} schema
 * @param {string[]} errors
 */
export function compareGpkgToBaselineSchema(db, schema, errors) {
  const { lowerToActualTable, lowerToContentMeta, uploadedFeatureLowerKeys } =
    indexFeatureLayersFromContents(db)
  const schemaByLower = indexSchemaLayersByLowerName(schema)

  reportUnexpectedFeatureLayers(
    uploadedFeatureLowerKeys,
    schemaByLower,
    lowerToActualTable,
    errors
  )

  for (const layerDef of schema.layers) {
    const lowerTable = layerDef.tableName.toLowerCase()
    if (!uploadedFeatureLowerKeys.has(lowerTable)) {
      // Layer not present in the uploaded GeoPackage — missing layers are not an error here;
      // GPKG_MISSING_LAYER is reported upstream by validateGpkg before this function is called.
      continue
    }

    // lowerToActualTable is built from the same SQL result set as uploadedFeatureLowerKeys,
    // so get() will always find a value. The fallback to layerDef.tableName is a pure safety net.
    /* v8 ignore next 1 */
    const actualTable = lowerToActualTable.get(lowerTable) ?? layerDef.tableName
    const contentMeta = lowerToContentMeta.get(lowerTable)

    compareOneLayerToBaselineSchema(
      db,
      layerDef,
      lowerTable,
      actualTable,
      contentMeta,
      errors
    )
  }
}

export { compareBaselineLayerSrs }
