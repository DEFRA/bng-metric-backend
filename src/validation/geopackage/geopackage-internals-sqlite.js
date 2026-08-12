import {
  GPKG_HEADER_BYTES,
  GPKG_FLAGS_BYTE_INDEX,
  GPKG_FLAGS_ENVELOPE_SHIFT,
  GPKG_ENVELOPE_INDICATOR_MASK,
  GPKG_ENVELOPE_SIZES,
  WKB_MIN_BYTES,
  WKB_TYPE_CODE_OFFSET,
  GEOPACKAGE_GEOMETRY_TYPE_NAMES
} from './geopackage-constants.js'

/** WKB well-known binary endian marker byte: little-endian payloads use 1. */
const WKB_LITTLE_ENDIAN_MARKER = 1

/**
 * Ordered SQLite type header patterns → canonical affinity token for baseline comparison.
 * First match wins (mirrors sequential if guards).
 */
const SQLITE_BASELINE_AFFINITY_RULES = Object.freeze([
  [/^BOOLEAN\b/, '~BOOLEAN'],
  [/^(?:DATE|DATETIME|TIMESTAMP)\b/, '~DATE'],
  [/^(?:TINYINT|SMALLINT|MEDIUMINT|BIGINT|INTEGER|INT)\b/, '~INTEGER'],
  [/^(?:REAL|FLOAT|DOUBLE(?:\s+PRECISION)?)\b/, '~FLOAT'],
  [/^(?:TEXT|CHARACTER\s+VARYING|VARCHAR)\b/, '~TEXT'],
  [/^BLOB\b/, '~BLOB'],
  [/^(?:NUMERIC|DECIMAL)\b/, '~NUMERIC']
])

/**
 * Allowed characters for a SQLite identifier used in dynamic SQL quoting.
 */
export const SAFE_SQL_IDENTIFIER = /^[A-Za-z_]\w*$/

/**
 * Extract the WKB geometry type code from a GeoPackageBinary blob.
 * Returns null if the blob is too short or has an unrecognised envelope indicator.
 * @param {Buffer} blob
 * @returns {number|null}
 */
export function getWkbType(blob) {
  if (!blob || blob.length < GPKG_HEADER_BYTES) {
    return null
  }
  const envelopeIndicator =
    (blob[GPKG_FLAGS_BYTE_INDEX] >> GPKG_FLAGS_ENVELOPE_SHIFT) &
    GPKG_ENVELOPE_INDICATOR_MASK
  const envelopeSize = GPKG_ENVELOPE_SIZES[envelopeIndicator]
  if (envelopeSize === undefined) {
    return null
  }
  const wkbOffset = GPKG_HEADER_BYTES + envelopeSize
  if (blob.length < wkbOffset + WKB_MIN_BYTES) {
    return null
  }
  const littleEndian = blob[wkbOffset] === WKB_LITTLE_ENDIAN_MARKER
  const typeOffset = wkbOffset + WKB_TYPE_CODE_OFFSET
  return littleEndian
    ? blob.readUInt32LE(typeOffset)
    : blob.readUInt32BE(typeOffset)
}

/**
 * Normalises declared SQLite affinity for GeoPackage-vs-template comparison.
 * INTEGER-sized types are equivalent; FLOAT/DOUBLE and REAL similarly; TEXT length is ignored.
 * Other types compare by their trimmed head before `(` (e.g. MULTIPOLYGON, DATE).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function baselineSqliteTypeComparable(value) {
  const trimmed = (typeof value === 'string' ? value : '').trim()
  if (!trimmed) {
    return ''
  }
  const upper = trimmed.toUpperCase()

  for (const [pattern, canon] of SQLITE_BASELINE_AFFINITY_RULES) {
    if (pattern.test(upper)) {
      return canon
    }
  }

  const head = upper.split('(')[0].trim()
  return head
}
/** Canonical SQLite affinity buckets → concise user-facing label (sentence case noun). */
const SQLITE_TYPE_BUCKET_LABEL = Object.freeze({
  '~INTEGER': 'Integer',
  '~FLOAT': 'Float',
  '~TEXT': 'Text',
  '~BOOLEAN': 'Boolean',
  '~DATE': 'Date',
  '~BLOB': 'Blob',
  '~NUMERIC': 'Numeric'
})

/**
 * Uppercase geometry type names from GeoPackage Annex G (Tables 30–31).
 * Used as SQLite column type heads in feature tables and in gpkg_geometry_columns.
 */
const GEOPACKAGE_GEOMETRY_TYPE_HEADS = new Set(GEOPACKAGE_GEOMETRY_TYPE_NAMES)

const GEOMETRY_TYPE_ZM_SUFFIX = 'ZM'
const GEOMETRY_TYPE_Z_SUFFIX = 'Z'
const GEOMETRY_TYPE_M_SUFFIX = 'M'
const GEOMETRY_TYPE_ZM_SUFFIX_LENGTH = GEOMETRY_TYPE_ZM_SUFFIX.length
const GEOMETRY_TYPE_SINGLE_SUFFIX_LENGTH = GEOMETRY_TYPE_M_SUFFIX.length

/**
 * @param {string} candidate
 * @returns {string|null}
 */
function knownGeometryBaseHead(candidate) {
  if (GEOPACKAGE_GEOMETRY_TYPE_HEADS.has(candidate)) {
    return candidate
  } else {
    return null
  }
}

/**
 * Strip optional Z / M / ZM suffixes from a comparable SQLite geometry type head.
 * Some producers (e.g. QGIS, GDAL) declare measured or 3D columns as MULTIPOLYGONM etc.
 * @param {string} comparableHead
 * @returns {string}
 */
function geometrySqliteTypeBaseHead(comparableHead) {
  const direct = knownGeometryBaseHead(comparableHead)
  if (direct !== null) {
    return direct
  } else if (comparableHead.endsWith(GEOMETRY_TYPE_ZM_SUFFIX)) {
    const zmBase = knownGeometryBaseHead(
      comparableHead.slice(0, -GEOMETRY_TYPE_ZM_SUFFIX_LENGTH)
    )
    if (zmBase === null) {
      return comparableHead
    }
    return zmBase
  } else if (
    comparableHead.endsWith(GEOMETRY_TYPE_Z_SUFFIX) ||
    comparableHead.endsWith(GEOMETRY_TYPE_M_SUFFIX)
  ) {
    const zOrMBase = knownGeometryBaseHead(
      comparableHead.slice(0, -GEOMETRY_TYPE_SINGLE_SUFFIX_LENGTH)
    )
    if (zOrMBase === null) {
      return comparableHead
    } else {
      return zOrMBase
    }
  } else {
    return comparableHead
  }
}

/**
 * @param {unknown} sqliteType
 * @returns {boolean}
 */
export function isGeometrySqliteColumnType(sqliteType) {
  const comparable = baselineSqliteTypeComparable(sqliteType)
  return GEOPACKAGE_GEOMETRY_TYPE_HEADS.has(
    geometrySqliteTypeBaseHead(comparable)
  )
}

/** GDAL / GeoPackage geometry pragma names → readable phrase ending in "geometry" where fitting. */
const SQLITE_GEOMETRY_TYPE_LABEL = Object.freeze({
  GEOMETRY: 'Geometry',
  POINT: 'Point geometry',
  MULTIPOINT: 'MultiPoint geometry',
  LINESTRING: 'Line geometry',
  MULTILINESTRING: 'Multi-line geometry',
  MULTIPOLYGON: 'MultiPolygon geometry',
  POLYGON: 'Polygon geometry',
  CURVE: 'Curve geometry',
  MULTICURVE: 'Multi-curve geometry',
  GEOMETRYCOLLECTION: 'Geometry collection',
  CIRCULARSTRING: 'Circular string geometry',
  COMPOUNDCURVE: 'Compound curve geometry',
  CURVEPOLYGON: 'Curve polygon geometry',
  MULTISURFACE: 'Multi-surface geometry',
  SURFACE: 'Surface geometry'
})

/**
 * @param {string} word leading token for a/an rule
 */
function indefiniteArticleDeterminer(word) {
  if (/^[aeiou]/i.test(word)) {
    return 'an'
  } else {
    return 'a'
  }
}

/**
 * Sentence-case a raw SQLite type head as a last-resort label.
 * @param {string} head uppercased, parenthesis-stripped type token
 * @returns {string}
 */
function fallbackTypeLabel(head) {
  const lowered = head.toLowerCase().replaceAll('_', ' ')
  return lowered.length > 0
    ? `${lowered[0].toUpperCase()}${lowered.slice(1)}`
    : 'unknown'
}

/**
 * User-facing type category for SQLite baseline mismatch strings.
 * @param {unknown} value
 */
export function sqliteTypeFriendlyCategoryLabel(value) {
  const canon = baselineSqliteTypeComparable(value)
  const bucketLabel = SQLITE_TYPE_BUCKET_LABEL[canon]
  if (bucketLabel) {
    return bucketLabel
  }
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    return 'unknown'
  }
  const head = trimmed.toUpperCase().split('(')[0].trim()
  const geo = SQLITE_GEOMETRY_TYPE_LABEL[geometrySqliteTypeBaseHead(head)]
  return geo ?? fallbackTypeLabel(head)
}

/**
 * Scalar SQLite kinds that read naturally with "… data type" in error copy.
 * Geometry and other structural types use a bare phrase (e.g. "Polygon geometry").
 */
const SQLITE_SCALAR_TYPE_LABELS = new Set(
  Object.values(SQLITE_TYPE_BUCKET_LABEL).concat(['unknown'])
)

/**
 * @param {string} actualTable
 * @param {string} columnName
 * @param {unknown} actualTypeRaw pragma `type`
 * @param {string} expectedSchemaSqlite sqliteType from baseline template
 */
export function formatColumnSQLiteTypeMismatchMessage(
  actualTable,
  columnName,
  actualTypeRaw,
  expectedSchemaSqlite
) {
  const trimmedActual =
    typeof actualTypeRaw === 'string' ? actualTypeRaw.trim() : ''
  const expectedLabel = sqliteTypeFriendlyCategoryLabel(expectedSchemaSqlite)
  if (!trimmedActual) {
    return `Layer "${actualTable}" baseline mismatch: column "${columnName}" has no SQLite column type declared but ${expectedLabel} was expected`
  }

  const actualLabel = sqliteTypeFriendlyCategoryLabel(actualTypeRaw)

  const scalarStyle = SQLITE_SCALAR_TYPE_LABELS.has(actualLabel)
  const actualFragment = scalarStyle
    ? `${indefiniteArticleDeterminer(actualLabel)} ${actualLabel} data type`
    : `${indefiniteArticleDeterminer(actualLabel)} ${actualLabel}`

  return `Layer "${actualTable}" baseline mismatch: column "${columnName}" has ${actualFragment} but ${expectedLabel} was expected`
}

/**
 * Quotes a SQLite double-quoted identifier (names read from an existing GeoPackage).
 * @param {string} name
 */
export function quoteSqliteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`
}

/**
 * Safe display for srs_id values in error messages (avoids "[object Object]").
 * @param {unknown} raw
 * @returns {string}
 */
export function formatSrsIdForError(raw) {
  if (raw === null || raw === undefined) {
    return 'unset'
  } else if (typeof raw === 'object') {
    return JSON.stringify(raw)
  } else if (typeof raw === 'string') {
    return raw
  } else if (
    typeof raw === 'number' ||
    typeof raw === 'boolean' ||
    typeof raw === 'bigint'
  ) {
    return String(raw)
  } else if (typeof raw === 'symbol') {
    return raw.toString()
  } else {
    return '[function]'
  }
}

/**
 * Integer EPSG-like srs_id from GeoPackage tables, or null if unset / unusable as an integer SRS.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
export function integerSrsCodeOrNull(raw) {
  if (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'string' && raw.trim() === '')
  ) {
    return null
  }
  const n = Number(raw)
  return Number.isInteger(n) ? n : null
}

/** @param {NonNullable<object>} value */
function diagnosticJsonStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable object]'
  }
}

function stringifyDiagnosticNumber(num) {
  return num.toString()
}

function stringifyDiagnosticBigInt(big) {
  return big.toString()
}

/**
 * Non-object, non-Error caught values (undefined uses typeof; null handled by caller).
 * Avoids string coercion on generic `unknown` (Sonar S6551).
 * @param {unknown} value
 */
function primitiveCaughtDiagnostic(value) {
  const kind = typeof value
  switch (kind) {
    case 'undefined':
      return 'undefined'
    case 'string':
      return value
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return stringifyDiagnosticNumber(/** @type {number} */ (value))
    case 'bigint':
      return stringifyDiagnosticBigInt(/** @type {bigint} */ (value))
    case 'symbol':
      return Symbol.prototype.toString.call(value)
    case 'function':
      return '[function]'
    default:
      /* v8 ignore next -- defensive; all standard typeof results are handled above */
      return '[unknown]'
  }
}

/**
 * Derive a log/detail string from a caught value (not always an Error).
 * @param {unknown} caught
 * @returns {string}
 */
export function caughtValueMessage(caught) {
  if (caught instanceof Error) {
    return caught.message
  } else if (caught !== null && typeof caught === 'object') {
    return diagnosticJsonStringify(caught)
  } else if (caught === null) {
    return 'null'
  } else {
    return primitiveCaughtDiagnostic(caught)
  }
}
