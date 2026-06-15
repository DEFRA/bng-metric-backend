import { ERROR_CODES, makeError } from './errors.js'
import { EXPECTED_GEOMETRY_COLUMN_COUNT } from './geopackage-constants.js'
import {
  quoteSqliteIdent,
  baselineSqliteTypeComparable,
  formatColumnSQLiteTypeMismatchMessage,
  isGeometrySqliteColumnType
} from './geopackage-internals-sqlite.js'

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

  if (geometryColumnsInTable.length > EXPECTED_GEOMETRY_COLUMN_COUNT) {
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
    } else {
      compareOneDefinedColumnToSchema(
        col,
        actualTable,
        actualByLowerName,
        errors
      )
    }
  }

  // Additional columns in the file beyond the baseline template are allowed (ignored).
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ columns: Array<{ sqliteType: string }>, geometryColumn: { geometryType: string } }} layerDef
 * @param {string} actualTable
 * @param {{ column_name: string, geometry_type_name: string, geom_srs_raw: unknown }} geomRow
 * @param {string[]} errors
 */
export function compareLayerTableColumnsToSchema(
  db,
  layerDef,
  actualTable,
  geomRow,
  errors
) {
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
