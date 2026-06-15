import { describe, it, expect } from 'vitest'

import { EPSG_BNG } from '../../../test/helpers/baseline-geopackage.js'
import {
  GPKG_HEADER_BYTES,
  GPKG_FLAGS_BYTE_INDEX,
  GPKG_ENVELOPE_XY_BYTES,
  WKB_MIN_BYTES,
  WKB_TYPE_CODE_OFFSET,
  WKB_POLYGON,
  GEOPACKAGE_GEOMETRY_TYPE_NAMES
} from './geopackage-constants.js'

const {
  getWkbType,
  baselineSqliteTypeComparable,
  isGeometrySqliteColumnType,
  sqliteTypeFriendlyCategoryLabel,
  formatColumnSQLiteTypeMismatchMessage,
  quoteSqliteIdent,
  integerSrsCodeOrNull,
  caughtValueMessage
} = await import('./geopackage-internals-sqlite.js')

const WKB_LITTLE_ENDIAN_MARKER = 1
const WKB_BIG_ENDIAN_MARKER = 0
const GPKG_NO_ENVELOPE_FLAGS = 0

function buildGpkgBinaryWithWkbType(typeCode, { littleEndian = true } = {}) {
  const total = GPKG_HEADER_BYTES + WKB_MIN_BYTES
  const buf = Buffer.alloc(total)
  buf[GPKG_FLAGS_BYTE_INDEX] = GPKG_NO_ENVELOPE_FLAGS
  buf[GPKG_HEADER_BYTES] = littleEndian
    ? WKB_LITTLE_ENDIAN_MARKER
    : WKB_BIG_ENDIAN_MARKER
  const typeOffset = GPKG_HEADER_BYTES + WKB_TYPE_CODE_OFFSET
  if (littleEndian) {
    buf.writeUInt32LE(typeCode, typeOffset)
  } else {
    buf.writeUInt32BE(typeCode, typeOffset)
  }
  return buf
}

describe('getWkbType', () => {
  it('returns null for missing, short, or invalid envelope payloads', () => {
    expect(getWkbType(null)).toBeNull()
    expect(getWkbType(Buffer.alloc(GPKG_HEADER_BYTES - 1))).toBeNull()

    const invalidEnvelope = Buffer.alloc(GPKG_HEADER_BYTES + WKB_MIN_BYTES)
    invalidEnvelope[GPKG_FLAGS_BYTE_INDEX] = 0xff
    expect(getWkbType(invalidEnvelope)).toBeNull()

    const shortAfterEnvelope = Buffer.alloc(GPKG_HEADER_BYTES + 1)
    shortAfterEnvelope[GPKG_FLAGS_BYTE_INDEX] = GPKG_NO_ENVELOPE_FLAGS
    expect(getWkbType(shortAfterEnvelope)).toBeNull()
  })

  it('reads little- and big-endian WKB type codes after the GeoPackageBinary header', () => {
    expect(getWkbType(buildGpkgBinaryWithWkbType(WKB_POLYGON))).toBe(
      WKB_POLYGON
    )
    expect(
      getWkbType(
        buildGpkgBinaryWithWkbType(WKB_POLYGON, { littleEndian: false })
      )
    ).toBe(WKB_POLYGON)
  })

  it('skips a declared XY envelope before reading the WKB slice', () => {
    const total = GPKG_HEADER_BYTES + GPKG_ENVELOPE_XY_BYTES + WKB_MIN_BYTES
    const buf = Buffer.alloc(total)
    buf[GPKG_FLAGS_BYTE_INDEX] = 2
    buf[GPKG_HEADER_BYTES + GPKG_ENVELOPE_XY_BYTES] = WKB_LITTLE_ENDIAN_MARKER
    buf.writeUInt32LE(
      WKB_POLYGON,
      GPKG_HEADER_BYTES + GPKG_ENVELOPE_XY_BYTES + WKB_TYPE_CODE_OFFSET
    )
    expect(getWkbType(buf)).toBe(WKB_POLYGON)
  })
})

describe('baselineSqliteTypeComparable', () => {
  it('normalises affinity families and bare type heads', () => {
    expect(baselineSqliteTypeComparable('')).toBe('')
    expect(baselineSqliteTypeComparable('INT')).toBe('~INTEGER')
    expect(baselineSqliteTypeComparable('DOUBLE PRECISION')).toBe('~FLOAT')
    expect(baselineSqliteTypeComparable('VARCHAR(255)')).toBe('~TEXT')
    expect(baselineSqliteTypeComparable('MULTIPOLYGON')).toBe('MULTIPOLYGON')
  })
})

describe('isGeometrySqliteColumnType', () => {
  it('recognises every Annex G base type and rejects unknown ZM suffixes', () => {
    for (const type of GEOPACKAGE_GEOMETRY_TYPE_NAMES) {
      expect(isGeometrySqliteColumnType(type)).toBe(true)
    }
    expect(isGeometrySqliteColumnType('NOTGEOMETRYZM')).toBe(false)
    expect(isGeometrySqliteColumnType('FOOBARM')).toBe(false)
  })
})

describe('sqliteTypeFriendlyCategoryLabel', () => {
  it('labels scalar buckets, geometry types, and unknown tokens', () => {
    expect(sqliteTypeFriendlyCategoryLabel('INTEGER')).toBe('Integer')
    expect(sqliteTypeFriendlyCategoryLabel('POLYGON')).toBe('Polygon geometry')
    expect(sqliteTypeFriendlyCategoryLabel('not_real')).toBe('Not real')
    expect(sqliteTypeFriendlyCategoryLabel(123)).toBe('unknown')
  })
})

describe('formatColumnSQLiteTypeMismatchMessage', () => {
  it('handles missing actual types and scalar actual types', () => {
    expect(
      formatColumnSQLiteTypeMismatchMessage('Layer', 'col', '', 'INTEGER')
    ).toMatch(/no SQLite column type declared/)
    expect(
      formatColumnSQLiteTypeMismatchMessage('Layer', 'col', 'TEXT', 'INTEGER')
    ).toMatch(/Text data type/)
  })
})

describe('quoteSqliteIdent', () => {
  it('escapes embedded double quotes', () => {
    expect(quoteSqliteIdent('a"b')).toBe('"a""b"')
  })
})

describe('integerSrsCodeOrNull', () => {
  it('parses integer srs codes and rejects empty or non-integer values', () => {
    expect(integerSrsCodeOrNull(null)).toBeNull()
    expect(integerSrsCodeOrNull('')).toBeNull()
    expect(integerSrsCodeOrNull('27700')).toBe(EPSG_BNG)
    expect(integerSrsCodeOrNull('27700.5')).toBeNull()
  })
})

describe('caughtValueMessage', () => {
  it('formats null and primitive caught values', () => {
    expect(caughtValueMessage(null)).toBe('null')
    expect(caughtValueMessage(true)).toBe('true')
    expect(caughtValueMessage(false)).toBe('false')
    expect(caughtValueMessage(42)).toBe('42')
    expect(caughtValueMessage(42n)).toBe('42')
    expect(caughtValueMessage(Symbol('x'))).toContain('Symbol')
    expect(caughtValueMessage(() => 1)).toBe('[function]')
  })
})
