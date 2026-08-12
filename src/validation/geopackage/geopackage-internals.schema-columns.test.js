import { describe, it, expect } from 'vitest'

import { EPSG_BNG, baselineSchema } from '../../../test/helpers/gpkg.js'

const { ERROR_CODES } = await import('./errors.js')
const {
  compareGeometryRegistrationRow,
  compareDefinedColumnsToSchema,
  pragmaTableInfoByLowerName
} = await import('./geopackage-internals.js')

const habitatsLayer = baselineSchema.layers.find(
  (l) => l.tableName === 'Habitats'
)

/** Shared layer stub for compareDefinedColumnsToSchema column-shape tests */
const MINIMAL_TWO_COLUMN_LAYER = Object.freeze({
  columns: Object.freeze([
    Object.freeze({
      name: 'fid',
      sqliteType: 'INTEGER',
      notNull: true,
      primaryKey: true
    }),
    Object.freeze({
      name: 'label',
      sqliteType: 'TEXT(99)',
      notNull: false,
      primaryKey: false
    })
  ])
})

function runCompareColumns(layer, tableName, pragmaMap) {
  const errors = []
  compareDefinedColumnsToSchema(layer, tableName, pragmaMap, errors)
  return errors
}

function firstSqliteTypeMismatch(errors) {
  return errors.find(
    (x) => x.code === ERROR_CODES.GPKG_BASELINE_COLUMN_SQLITE_TYPE
  )
}

function sqliteTypeErrors(errors) {
  return errors.filter(
    (x) => x.code === ERROR_CODES.GPKG_BASELINE_COLUMN_SQLITE_TYPE
  )
}

/** One declarative column matching template fixtures in this module */
function schemaCol(name, sqliteType, notNull = false, primaryKey = false) {
  return { name, sqliteType, notNull, primaryKey }
}

/** One PRAGMA `table_info` row as consumed by compareDefinedColumnsToSchema */
function pragma(name, type, notnull = 0, pk = 0) {
  return Object.freeze({ name, type, notnull, pk })
}

/** Deliberately not a string — exercises `unknown` labelling in mismatch copy */
const NON_STRING_TEMPLATE_SQLITE_TYPE_EXAMPLE = 123

function geometryRegCompareErrors(regRow) {
  const errors = []
  compareGeometryRegistrationRow(habitatsLayer, 'Habitats', regRow, errors)
  return errors
}

describe('compareGeometryRegistrationRow', () => {
  it('accepts any safe geometry column name', () => {
    const errors = geometryRegCompareErrors({
      column_name: 'shape',
      geometry_type_name: 'MULTIPOLYGON',
      geom_srs_raw: EPSG_BNG
    })
    expect(errors).toEqual([])
  })

  it('reports GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME when the name is not a safe SQLite identifier', () => {
    const errors = geometryRegCompareErrors({
      column_name: 'geom-bad',
      geometry_type_name: 'MULTIPOLYGON',
      geom_srs_raw: EPSG_BNG
    })
    expect(errors[0].code).toBe(
      ERROR_CODES.GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME
    )
  })

  it('reports a GPKG_BASELINE_GEOMETRY_TYPE_NAME error when geometry type does not match', () => {
    const errors = geometryRegCompareErrors({
      column_name: 'geom',
      geometry_type_name: 'POINT',
      geom_srs_raw: EPSG_BNG
    })
    expect(errors[0].message).toMatch(/geometry type/)
  })
})

describe('pragmaTableInfoByLowerName', () => {
  it('returns an empty map when PRAGMA throws', () => {
    const brokenDb = {
      prepare() {
        throw new Error('invalid pragma')
      }
    }
    const map = pragmaTableInfoByLowerName(brokenDb, 'AnyTable')
    expect(map.size).toBe(0)
  })

  it('normalises a null column type to an empty string', () => {
    const fakeDb = {
      prepare() {
        return {
          all: () => [{ cid: 0, name: 'col', type: null, notnull: 0, pk: 0 }]
        }
      }
    }
    const map = pragmaTableInfoByLowerName(fakeDb, 'T')
    expect(map.get('col').type).toBe('')
  })
})

describe('compareDefinedColumnsToSchema (minimal — presence and sqlite type)', () => {
  it('reports GPKG_BASELINE_MISSING_COLUMN when a required column is absent', () => {
    const errors = runCompareColumns(MINIMAL_TWO_COLUMN_LAYER, 'T', new Map())
    expect(errors.some((e) => e.message.includes('missing column "fid"'))).toBe(
      true
    )
  })

  it('reports GPKG_BASELINE_COLUMN_SQLITE_TYPE when the column type does not match', () => {
    const wrongTypeMap = new Map([
      ['fid', pragma('fid', 'TEXT', 1, 1)],
      ['label', pragma('label', 'TEXT(99)')]
    ])
    const typeErrors = sqliteTypeErrors(
      runCompareColumns(MINIMAL_TWO_COLUMN_LAYER, 'T', wrongTypeMap)
    )
    expect(typeErrors.length).toBeGreaterThanOrEqual(1)
    expect(typeErrors.some((e) => e.message.includes('"fid"'))).toBe(true)
    expect(typeErrors.some((e) => e.message.includes('was expected'))).toBe(
      true
    )
    expect(typeErrors.some((e) => e.message.includes('Text data type'))).toBe(
      true
    )
    expect(typeErrors.some((e) => e.message.includes('Integer was'))).toBe(true)
  })
})

describe('compareDefinedColumnsToSchema (minimal — NOT NULL / primary key)', () => {
  it('reports GPKG_BASELINE_COLUMN_NOT_NULL when NOT NULL expectation mismatches', () => {
    const fidInteger = new Map([
      ['fid', pragma('fid', 'INTEGER', 0, 1)],
      ['label', pragma('label', 'TEXT(99)', 1)]
    ])
    const errors = runCompareColumns(MINIMAL_TWO_COLUMN_LAYER, 'T', fidInteger)
    expect(errors.some((e) => e.message.includes('NOT NULL'))).toBe(true)
  })

  it('reports GPKG_BASELINE_COLUMN_PRIMARY_KEY when pk expectation mismatches', () => {
    const labelOkButPk = new Map([
      ['fid', pragma('fid', 'INTEGER', 1, 0)],
      ['label', pragma('label', 'TEXT(99)')]
    ])
    const errors = runCompareColumns(
      MINIMAL_TWO_COLUMN_LAYER,
      'T',
      labelOkButPk
    )
    expect(errors.some((e) => e.message.includes('primary key'))).toBe(true)
  })
})

describe('compareDefinedColumnsToSchema (wording — affinity labels)', () => {
  it.each([
    {
      title: 'MEDIUMINT vs TEXT — Integer / Text wording',
      column: 'Baseline Condition',
      mapKey: 'baseline condition',
      pragmaType: 'MEDIUMINT',
      templateType: 'TEXT(99)',
      expected:
        'Layer "Habitats" baseline mismatch: column "Baseline Condition" has an Integer data type but Text was expected'
    },
    {
      title: 'BOOLEAN vs TEXT',
      column: 'Baseline Distinctiveness',
      mapKey: 'baseline distinctiveness',
      pragmaType: 'BOOLEAN',
      templateType: 'TEXT(99)',
      expected:
        'Layer "Habitats" baseline mismatch: column "Baseline Distinctiveness" has a Boolean data type but Text was expected'
    }
  ])('$title', ({ column, mapKey, pragmaType, templateType, expected }) => {
    const layer = {
      columns: [schemaCol(column, templateType)]
    }
    const map = new Map([[mapKey, pragma(column, pragmaType)]])
    const e = firstSqliteTypeMismatch(runCompareColumns(layer, 'Habitats', map))
    expect(e).toBeDefined()
    expect(e.message).toBe(expected)
  })
})

describe('compareDefinedColumnsToSchema (unknown and custom template tokens)', () => {
  it('uses unknown when template sqliteType is non-string', () => {
    const layer = {
      columns: [
        schemaCol(
          'x',
          /** @type {any} */ (NON_STRING_TEMPLATE_SQLITE_TYPE_EXAMPLE)
        )
      ]
    }
    const map = new Map([['x', pragma('x', 'TEXT(99)')]])
    const e = firstSqliteTypeMismatch(runCompareColumns(layer, 'T', map))
    expect(e).toBeDefined()
    expect(e.message).toBe(
      `Layer "T" baseline mismatch: column "x" has a Text data type but unknown was expected`
    )
  })

  it('title-cases unknown template SQLite tokens containing underscores', () => {
    const layer = {
      columns: [schemaCol('c', 'CUSTOM_KIND_NAME')]
    }
    const map = new Map([['c', pragma('c', 'INTEGER')]])
    const e = firstSqliteTypeMismatch(runCompareColumns(layer, 'T', map))
    expect(e).toBeDefined()
    expect(e.message).toContain(
      'Layer "T" baseline mismatch: column "c" has an Integer data type but Custom kind name was expected'
    )
  })
})

describe('compareDefinedColumnsToSchema (affinity BLOB NUMERIC)', () => {
  it('reports Blob and Numeric in mismatch copy', () => {
    const layer = {
      columns: [schemaCol('a', 'TEXT(99)'), schemaCol('b', 'INTEGER')]
    }
    const map = new Map([
      ['a', pragma('a', 'BLOB')],
      ['b', pragma('b', 'NUMERIC')]
    ])
    const errors = runCompareColumns(layer, 'T', map)
    expect(sqliteTypeErrors(errors)).toHaveLength(2)
    expect(errors.some((x) => x.message.includes('Blob data type'))).toBe(true)
    expect(errors.some((x) => x.message.includes('Numeric data type'))).toBe(
      true
    )
  })
})

describe('compareDefinedColumnsToSchema (geometry columns)', () => {
  it('skips geometry columns — validated separately from attribute columns', () => {
    const layer = { columns: [schemaCol('g', 'MULTIPOLYGON')] }
    const map = new Map([['g', pragma('g', 'INTEGER')]])
    expect(runCompareColumns(layer, 'GeoLayer', map)).toEqual([])
  })
})

describe('compareDefinedColumnsToSchema (affinity integer-width family)', () => {
  it('treats INT MEDIUMINT TINYINT SMALLINT as INTEGER', () => {
    const layer = {
      columns: [
        schemaCol('a', 'INTEGER'),
        schemaCol('b', 'INTEGER'),
        schemaCol('c', 'INTEGER'),
        schemaCol('d', 'INTEGER')
      ]
    }
    const okMap = new Map([
      ['a', pragma('a', 'INT')],
      ['b', pragma('b', 'MEDIUMINT')],
      ['c', pragma('c', 'TINYINT')],
      ['d', pragma('d', 'SMALLINT')]
    ])
    expect(sqliteTypeErrors(runCompareColumns(layer, 'T', okMap)).length).toBe(
      0
    )
  })
})

describe('compareDefinedColumnsToSchema (affinity float family)', () => {
  it('treats FLOAT and DOUBLE PRECISION as one affinity', () => {
    const layer = {
      columns: [schemaCol('x', 'DOUBLE'), schemaCol('y', 'FLOAT')]
    }
    const okMap = new Map([
      ['x', pragma('x', 'FLOAT')],
      ['y', pragma('y', 'DOUBLE PRECISION')]
    ])
    expect(sqliteTypeErrors(runCompareColumns(layer, 'T', okMap)).length).toBe(
      0
    )
  })
})

describe('compareDefinedColumnsToSchema (affinity TEXT width)', () => {
  it('ignores differing TEXT(n) width when comparing', () => {
    const layer = { columns: [schemaCol('label', 'TEXT(99)')] }
    const okMap = new Map([['label', pragma('label', 'TEXT(5)')]])
    expect(sqliteTypeErrors(runCompareColumns(layer, 'T', okMap)).length).toBe(
      0
    )
  })
})

describe('compareDefinedColumnsToSchema (null pragma type)', () => {
  it('treats null pragma type as undeclared vs template TEXT', () => {
    const layer = { columns: [schemaCol('col', 'TEXT')] }
    const mapWithNullType = new Map([['col', pragma('col', null)]])
    const errors = runCompareColumns(layer, 'T', mapWithNullType)
    expect(
      errors.some(
        (e) =>
          e.code === ERROR_CODES.GPKG_BASELINE_COLUMN_SQLITE_TYPE &&
          e.message.includes('no SQLite column type declared')
      )
    ).toBe(true)
  })
})
