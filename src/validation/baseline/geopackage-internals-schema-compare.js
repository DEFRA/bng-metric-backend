import { ERROR_CODES, makeError } from './errors.js'
import {
  RLB_LYR,
  HABITATS_LYR,
  GPKG_CONTENTS_FEATURES_DATA_TYPE
} from './geopackage-constants.js'
import { compareBaselineLayerSrs } from './geopackage-internals-schema-compare-srs.js'
import {
  SAFE_SQL_IDENTIFIER,
  quoteSqliteIdent,
  baselineSqliteTypeComparable,
  formatColumnSQLiteTypeMismatchMessage,
  isGeometrySqliteColumnType
} from './geopackage-internals-sqlite.js'

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
 * @param {string} actualTable
 * @param {{ column_name: string }} geomRow
 * @param {Map<string, { name: string, type: string, notnull: number, pk: number }>} actualByLowerName
 * @param {string} expectedGeomSqliteType
 * @param {string[]} errors
 */
function compareRegisteredGeometryColumnInTable(
  actualTable,
  geomRow,
  actualByLowerName,
  expectedGeomSqliteType,
  errors
) {
  const geometryColumnsInTable = [...actualByLowerName.values()].filter((col) =>
    isGeometrySqliteColumnType(col.type)
  )

  if (geometryColumnsInTable.length > 1) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_MULTIPLE_GEOMETRY_COLUMNS,
        `Layer "${actualTable}" baseline mismatch: expected exactly one geometry column in the feature table but found ${geometryColumnsInTable.length}`
      )
    )
    return
  }

  const registered = actualByLowerName.get(
    String(geomRow.column_name).toLowerCase()
  )
  if (!registered) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_MISSING_COLUMN,
        `Layer "${actualTable}" baseline mismatch: missing geometry column "${geomRow.column_name}"`
      )
    )
    return
  }

  if (
    !isGeometrySqliteColumnType(registered.type) ||
    baselineSqliteTypeComparable(registered.type) !==
      baselineSqliteTypeComparable(expectedGeomSqliteType)
  ) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_COLUMN_SQLITE_TYPE,
        formatColumnSQLiteTypeMismatchMessage(
          actualTable,
          geomRow.column_name,
          registered.type,
          expectedGeomSqliteType
        )
      )
    )
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} actualTable
 * @returns {Map<string, { name: string, type: string, notnull: number, pk: number }>}
 */
export function pragmaTableInfoByLowerName(db, actualTable) {
  /** @type {Array<{ cid: number, name: string, type: string, notnull: number, pk: number }>} */
  let pragmaRows
  try {
    pragmaRows = db
      .prepare(`PRAGMA table_info(${quoteSqliteIdent(actualTable)})`)
      .all()
  } catch {
    pragmaRows = []
  }

  /** @type {Map<string, { name: string, type: string, notnull: number, pk: number }>} */
  const actualByLowerName = new Map()
  for (const pr of pragmaRows) {
    actualByLowerName.set(String(pr.name).toLowerCase(), {
      name: pr.name,
      type: pr.type ?? '',
      notnull: pr.notnull,
      pk: pr.pk
    })
  }

  return actualByLowerName
}

/**
 * @param {{ name: string, type: string, notnull: number, pk: number }} actual
 * @param {{ name: string, sqliteType: string, notNull: boolean, primaryKey: boolean }} col
 * @param {string} actualTable
 * @param {string[]} errors
 */
function reportDefinedColumnShapeMismatches(actual, col, actualTable, errors) {
  if (
    baselineSqliteTypeComparable(actual.type) !==
    baselineSqliteTypeComparable(col.sqliteType)
  ) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_COLUMN_SQLITE_TYPE,
        formatColumnSQLiteTypeMismatchMessage(
          actualTable,
          col.name,
          actual.type,
          col.sqliteType
        )
      )
    )
  }

  if (!!actual.notnull !== !!col.notNull) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_COLUMN_NOT_NULL,
        `Layer "${actualTable}" baseline mismatch: column "${col.name}" NOT NULL (${col.notNull ? 'required' : 'optional'}) does not match file`
      )
    )
  }

  if (!!actual.pk !== !!col.primaryKey) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_COLUMN_PRIMARY_KEY,
        `Layer "${actualTable}" baseline mismatch: primary key expectation for "${col.name}" does not match file`
      )
    )
  }
}

/**
 * @param {{ name: string, sqliteType: string, notNull: boolean, primaryKey: boolean }} col
 * @param {string} actualTable
 * @param {Map<string, { name: string, type: string, notnull: number, pk: number }>} actualByLowerName
 * @param {string[]} errors
 */
function compareOneDefinedColumnToSchema(
  col,
  actualTable,
  actualByLowerName,
  errors
) {
  const actual = actualByLowerName.get(String(col.name).toLowerCase())
  if (!actual) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_MISSING_COLUMN,
        `Layer "${actualTable}" baseline mismatch: missing column "${col.name}"`
      )
    )
    return
  }

  reportDefinedColumnShapeMismatches(actual, col, actualTable, errors)
}

/**
 * @param {{ columns: Array<{ name: string, sqliteType: string, notNull: boolean, primaryKey: boolean }> }} layerDef
 * @param {string} actualTable
 * @param {Map<string, { name: string, type: string, notnull: number, pk: number }>} actualByLowerName
 * @param {string[]} errors
 */
export function compareDefinedColumnsToSchema(
  layerDef,
  actualTable,
  actualByLowerName,
  errors
) {
  for (const col of layerDef.columns) {
    if (isGeometrySqliteColumnType(col.sqliteType)) {
      // Geometry columns are validated separately from attribute columns.
      continue
    }

    compareOneDefinedColumnToSchema(col, actualTable, actualByLowerName, errors)
  }

  // Additional columns in the file beyond the baseline template are allowed (ignored).
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
    return
  }

  if (geomRows.length > 1) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_BASELINE_MULTIPLE_GEOMETRY_COLUMNS,
        `Layer "${actualTable}" baseline mismatch: expected exactly one geometry column in gpkg_geometry_columns but found ${geomRows.length}`
      )
    )
    return
  }

  const geomRow = geomRows[0]

  compareBaselineLayerSrs(layerDef, actualTable, contentMeta, geomRow, errors)

  compareGeometryRegistrationRow(layerDef, actualTable, geomRow, errors)

  const actualByLowerName = pragmaTableInfoByLowerName(db, actualTable)

  const geometryColumnFromSchema = layerDef.columns.find((col) =>
    isGeometrySqliteColumnType(col.sqliteType)
  )
  compareRegisteredGeometryColumnInTable(
    actualTable,
    geomRow,
    actualByLowerName,
    geometryColumnFromSchema?.sqliteType ??
      layerDef.geometryColumn.geometryType,
    errors
  )

  compareDefinedColumnsToSchema(
    layerDef,
    actualTable,
    actualByLowerName,
    errors
  )
}

/**
 * Uploaded feature layers must match baseline-template.schema.json columns, crs, geometry.
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
