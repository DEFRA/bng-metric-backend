import { describe, it, expect } from 'vitest'

import { EPSG_BNG, baselineSchema } from '../../../test/helpers/gpkg.js'
import { GEOPACKAGE_GEOMETRY_TYPE_NAMES } from './geopackage-constants.js'

const { ERROR_CODES } = await import('./errors.js')
const {
  formatSrsIdForError,
  compareGpkgContentsToLayerSchema,
  compareBaselineLayerSrs
} = await import('./geopackage-internals.js')

const {
  sqliteTypeFriendlyCategoryLabel,
  formatColumnSQLiteTypeMismatchMessage,
  caughtValueMessage,
  isGeometrySqliteColumnType
} = await import('./geopackage-internals-sqlite.js')

const habitatsLayer = baselineSchema.layers.find(
  (l) => l.tableName === 'Habitats'
)

const SRS_BARE_LAYER = Object.freeze({ srsId: EPSG_BNG })

const SRS_GEOM_ROW_BNG = Object.freeze({
  column_name: 'geom',
  geometry_type_name: 'MULTIPOLYGON',
  geom_srs_raw: EPSG_BNG
})

describe('caughtValueMessage', () => {
  it('uses Error#message or stringifies non-Errors', () => {
    expect(caughtValueMessage(new Error('bad sql'))).toBe('bad sql')
    expect(caughtValueMessage('literal')).toBe('literal')
    expect(caughtValueMessage(undefined)).toBe('undefined')
    expect(caughtValueMessage({ code: 'x' })).toBe('{"code":"x"}')
    const circular = {}
    circular.self = circular
    expect(caughtValueMessage(circular)).toBe('[unserializable object]')
  })
})

describe('formatSrsIdForError', () => {
  it('formats nullish, objects, primitives and edge kinds', () => {
    expect(formatSrsIdForError(null)).toBe('unset')
    expect(formatSrsIdForError(undefined)).toBe('unset')
    expect(formatSrsIdForError({ x: 1 })).toBe('{"x":1}')
    expect(formatSrsIdForError('27700')).toBe('27700')
    expect(formatSrsIdForError(EPSG_BNG)).toBe('27700')
    expect(formatSrsIdForError(true)).toBe('true')
    expect(formatSrsIdForError(42n)).toBe('42')
    expect(formatSrsIdForError(Symbol('srs'))).toContain('Symbol')
    expect(formatSrsIdForError(() => 1)).toBe('[function]')
  })
})

describe('sqliteTypeFriendlyCategoryLabel', () => {
  it('returns unknown when the SQLite type head parses to empty', () => {
    expect(sqliteTypeFriendlyCategoryLabel('(')).toBe('unknown')
  })

  it('title-cases underscore tokens outside known buckets', () => {
    expect(sqliteTypeFriendlyCategoryLabel('CUSTOM_TYPE_HERE')).toBe(
      'Custom type here'
    )
  })

  it('maps Z/M dimensional geometry variants to the base geometry label', () => {
    expect(sqliteTypeFriendlyCategoryLabel('MULTIPOLYGONM')).toBe(
      'MultiPolygon geometry'
    )
    expect(sqliteTypeFriendlyCategoryLabel('LINESTRINGZ')).toBe('Line geometry')
  })
})

describe('isGeometrySqliteColumnType', () => {
  it('recognises all GeoPackage Annex G base geometry types', () => {
    for (const type of GEOPACKAGE_GEOMETRY_TYPE_NAMES) {
      expect(isGeometrySqliteColumnType(type)).toBe(true)
    }
  })

  it('recognises Z/M/ZM dimensional variants used by some producers', () => {
    for (const type of [
      'POINTM',
      'MULTIPOINTM',
      'LINESTRINGM',
      'MULTILINESTRINGM',
      'POLYGONM',
      'MULTIPOLYGONM',
      'MULTIPOLYGONZ',
      'MULTIPOLYGONZM'
    ]) {
      expect(isGeometrySqliteColumnType(type)).toBe(true)
    }
  })

  it('returns false for scalar SQLite types', () => {
    expect(isGeometrySqliteColumnType('INTEGER')).toBe(false)
    expect(isGeometrySqliteColumnType('TEXT')).toBe(false)
  })
})

describe('formatColumnSQLiteTypeMismatchMessage', () => {
  it('uses bare geometry phrasing when the actual type is a known geometry flavour', () => {
    expect(
      formatColumnSQLiteTypeMismatchMessage(
        'Habitats',
        'fid',
        'MULTIPOLYGON',
        'INTEGER'
      )
    ).toMatch(/has a MultiPolygon geometry but Integer was expected/)
  })
})

describe('compareGpkgContentsToLayerSchema', () => {
  it('reports a GPKG_BASELINE_CONTENTS_DATA_TYPE error when data_type does not match', () => {
    const errors = []
    compareGpkgContentsToLayerSchema(
      habitatsLayer,
      'Habitats',
      { data_type: 'tiles', srs_id: EPSG_BNG },
      errors
    )
    expect(errors.some((e) => e.message.includes('data_type'))).toBe(true)
    expect(errors[0].code).toBe(ERROR_CODES.GPKG_BASELINE_CONTENTS_DATA_TYPE)
  })
})

describe('compareBaselineLayerSrs — no geometry registration row', () => {
  it('reports GPKG_BASELINE_SRS_ID against gpkg_contents srs_id', () => {
    const errors = []
    compareBaselineLayerSrs(
      SRS_BARE_LAYER,
      'Habitats',
      { srs_id: 4326 },
      null,
      errors
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe(ERROR_CODES.GPKG_BASELINE_SRS_ID)
    expect(errors[0].message).toContain('gpkg_contents')
  })

  it('reports GPKG_BASELINE_SRS_ID when contentMeta is undefined', () => {
    const errors = []
    compareBaselineLayerSrs(SRS_BARE_LAYER, 'Habitats', undefined, null, errors)
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe(ERROR_CODES.GPKG_BASELINE_SRS_ID)
    expect(errors[0].message).toContain('unset')
    expect(errors[0].message).toContain('gpkg_contents')
  })
})

describe('compareBaselineLayerSrs — geometry row: wrong baseline integer', () => {
  it('reports GPKG_BASELINE_SRS_ID when integer srs disagrees with baseline', () => {
    const errors = []
    compareBaselineLayerSrs(
      SRS_BARE_LAYER,
      'Habitats',
      { srs_id: 4326 },
      {
        column_name: 'geom',
        geometry_type_name: 'MULTIPOLYGON',
        geom_srs_raw: 4326
      },
      errors
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe(ERROR_CODES.GPKG_BASELINE_SRS_ID)
    expect(errors[0].message).toContain('4326')
  })
})

describe('compareBaselineLayerSrs — geometry row: cross-table inconsistency', () => {
  it('reports GPKG_BASELINE_GPKG_SRS_INCONSISTENT when contents vs geometry disagree', () => {
    const errors = []
    compareBaselineLayerSrs(
      SRS_BARE_LAYER,
      'Habitats',
      { srs_id: EPSG_BNG },
      {
        column_name: 'geom',
        geometry_type_name: 'MULTIPOLYGON',
        geom_srs_raw: 4326
      },
      errors
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe(ERROR_CODES.GPKG_BASELINE_GPKG_SRS_INCONSISTENT)
  })
})

describe('compareBaselineLayerSrs — geometry row: non-integer srs payloads', () => {
  it('reports GPKG_BASELINE_SRS_ID when neither srs_id parses as an integer', () => {
    const errors = []
    compareBaselineLayerSrs(
      SRS_BARE_LAYER,
      'Habitats',
      { srs_id: 'not-an-int' },
      {
        column_name: 'geom',
        geometry_type_name: 'MULTIPOLYGON',
        geom_srs_raw: 'also-not-an-int'
      },
      errors
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe(ERROR_CODES.GPKG_BASELINE_SRS_ID)
    expect(errors[0].message).toMatch(
      /could not read a valid integer srs_id from gpkg_contents/
    )
  })
})

describe('compareBaselineLayerSrs — geometry row: agrees with baseline', () => {
  it('emits no SRS errors when both tables match baseline', () => {
    const errors = []
    compareBaselineLayerSrs(
      SRS_BARE_LAYER,
      'Habitats',
      { srs_id: EPSG_BNG },
      SRS_GEOM_ROW_BNG,
      errors
    )
    expect(
      errors.filter(
        (e) =>
          e.code === ERROR_CODES.GPKG_BASELINE_SRS_ID ||
          e.code === ERROR_CODES.GPKG_BASELINE_GPKG_SRS_INCONSISTENT
      )
    ).toHaveLength(0)
  })
})
