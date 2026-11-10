import {
  FEATURE_UUID,
  PARENT_GEOM,
  PARENT_UUID,
  RED_LINE_BOUNDARY
} from 'bng-library/bng-service'

import { ERROR_CODES, makeError } from './errors.js'
import { GPKG_CONTENTS_FEATURES_DATA_TYPE } from './geopackage-constants.js'
import { quoteSqliteIdent } from './geopackage-internals-sqlite.js'
import { SAMPLE_CAP } from './offenders.js'
import { MAX_PARENT_GEOM_CHARS } from './service-template/lineage/parent-links.js'
import {
  REF_COLUMNS,
  SHORT_TEXT_LIMIT,
  allowedValuesOf,
  characterCount,
  columnKey,
  isNullWord,
  normaliseListValue,
  shownValue,
  textLimitOf
} from './text-limits.js'

/**
 * The checks on an uploaded file's text values, run straight after the format
 * gate and before anything else reads a value (BMD-1175):
 *
 * 1. every limited column holds no more characters than its limit;
 * 2. then, only when every value fits, each drop-down or filled-in column
 *    holds a value that one of its lists offers, feature_uuid and
 *    parent_uuid hold UUIDs, and parent_geom holds WKT of the table's shape.
 *
 * The checks read the file with SQL, table by table, whatever the template,
 * and fetch only the values that fail: a value no longer in bytes than its
 * limit cannot be longer in characters, so only longer ones are read. So a
 * value over its limit is refused before any lookup, any parse, the
 * geometry checks or the lineage checks see it, and is never held whole by
 * more than this check.
 *
 * A blank value passes every check here: whether a value may be missing is
 * for the checks that follow, as before.
 */

const RED_LINE_KEY = columnKey(RED_LINE_BOUNDARY)

// The GeoJSON types a table's shape may take in parent_geom: its own, or the
// multi form of it.
const PARENT_SHAPES = Object.freeze({
  POINT: ['Point', 'MultiPoint'],
  MULTIPOINT: ['Point', 'MultiPoint'],
  LINESTRING: ['LineString', 'MultiLineString'],
  MULTILINESTRING: ['LineString', 'MultiLineString'],
  POLYGON: ['Polygon', 'MultiPolygon'],
  MULTIPOLYGON: ['Polygon', 'MultiPolygon']
})

/**
 * @typedef {object} TextTable
 * @property {string} name
 * @property {string} geometryType as gpkg_geometry_columns records it
 * @property {string[]} columns
 * @property {string | null} refColumn the column that names a feature
 */

/**
 * The feature tables to check, with their columns.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {(table: string) => boolean} includeTable
 * @returns {TextTable[]}
 */
function featureTables(db, includeTable) {
  const geometryTypes = new Map(
    db
      .prepare(
        'SELECT table_name, geometry_type_name FROM gpkg_geometry_columns'
      )
      .all()
      .map((row) => [
        String(row.table_name).toLowerCase(),
        String(row.geometry_type_name).toUpperCase()
      ])
  )
  return db
    .prepare(
      'SELECT table_name FROM gpkg_contents WHERE lower(CAST(data_type AS TEXT)) = ? ORDER BY rowid'
    )
    .all(GPKG_CONTENTS_FEATURES_DATA_TYPE)
    .map((row) => String(row.table_name))
    .filter(includeTable)
    .map((name) => {
      const columns = db
        .prepare(`PRAGMA table_info(${quoteSqliteIdent(name)})`)
        .all()
        .map((column) => String(column.name))
      const refKeys = new Set(REF_COLUMNS.map(columnKey))
      return {
        name,
        geometryType: geometryTypes.get(name.toLowerCase()) ?? '',
        columns,
        refColumn:
          columns.find((column) => refKeys.has(columnKey(column))) ?? null
      }
    })
}

/**
 * The start of a SELECT that reads a row's id and reference, and `extraSql`.
 * The id is the rowid, which a GeoPackage feature table's integer primary key
 * aliases whatever the tool that wrote it named the column.
 */
function rowSelect(table, extraSql = '') {
  // A reference too long to name a feature by is not read at all.
  const refColumn = table.refColumn && quoteSqliteIdent(table.refColumn)
  const ref = refColumn
    ? `CASE WHEN octet_length(${refColumn}) <= ${MAX_REF_BYTES} THEN CAST(${refColumn} AS BLOB) END`
    : 'NULL'
  const extra = extraSql ? `, ${extraSql}` : ''
  return `SELECT rowid AS fid, ${ref} AS ref${extra}`
}

// UTF-8 needs at most four bytes for one character, so a reference longer
// than this cannot be within its limit.
const MAX_UTF8_BYTES = 4
const MAX_REF_BYTES = SHORT_TEXT_LIMIT * MAX_UTF8_BYTES

/**
 * A feature's reference, as its error's sample names it: null where it is
 * blank, too long or not text, and the frontend names the feature by its row.
 *
 * @param {TextTable} table
 * @param {{ ref: unknown }} row
 * @returns {string | null}
 */
function usableRef(table, row) {
  const ref = Buffer.isBuffer(row.ref) ? row.ref.toString('utf8').trim() : ''
  const refLimit = table.refColumn ? textLimitOf(table.refColumn) : null
  const usable =
    ref !== '' && refLimit !== null && characterCount(ref) <= refLimit
  return usable ? ref : null
}

/**
 * One value that fails, as its error's sample names it: the table, the
 * feature's row and reference, the column, and `extra`, the values the
 * frontend's wording of the code fills in. The frontend reads these keys for
 * each bullet (error-file controller, textValueValues), so a key renamed here
 * must be renamed there.
 *
 * @param {string} code
 * @param {TextTable} table
 * @param {{ fid: unknown, ref: unknown }} row
 * @param {string} column
 * @param {object} [extra]
 */
function offender(code, table, row, column, extra = {}) {
  return {
    code,
    table: table.name,
    fid: Number(row.fid),
    ref: usableRef(table, row),
    column: column.trim(),
    ...extra
  }
}

/**
 * A limited column's length as SQLite measures it, so that no long value is
 * read into memory: null where its bytes fit the limit (its characters then
 * fit too); otherwise its characters once trimmed. A BLOB, and text holding a
 * NUL, which SQLite's length() stops at, are measured in bytes.
 */
function measuredSql(column, limit) {
  const value = quoteSqliteIdent(column)
  return [
    'CASE',
    `WHEN octet_length(${value}) <= ${limit} THEN NULL`,
    `WHEN typeof(${value}) = 'blob' THEN length(${value})`,
    `WHEN instr(CAST(${value} AS BLOB), x'00') > 0 THEN octet_length(${value})`,
    `ELSE length(trim(CAST(${value} AS TEXT), ${BLANK_CHARACTERS}))`,
    'END'
  ].join(' ')
}

/**
 * The values over their limit in one table, read in one pass. A value no
 * longer in bytes than its limit cannot be longer in characters, so only
 * longer ones are read, and only in the row that holds one.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {TextTable} table
 */
function overLimitErrors(db, table) {
  const limited = table.columns
    .map((column) => ({ column, limit: textLimitOf(column) }))
    .filter(({ limit }) => limit !== null)
  if (limited.length === 0) {
    return []
  }
  const measured = limited
    .map(({ column, limit }, i) => `${measuredSql(column, limit)} AS c${i}`)
    .join(', ')
  const anyOver = limited
    .map(
      ({ column, limit }) =>
        `octet_length(${quoteSqliteIdent(column)}) > ${limit}`
    )
    .join(' OR ')
  const rows = db
    .prepare(
      `${rowSelect(table, measured)} FROM ${quoteSqliteIdent(table.name)} WHERE ${anyOver}`
    )
    .iterate()
  return Array.from(rows).flatMap((row) =>
    limited.flatMap(({ column, limit }, i) => {
      const length = row[`c${i}`]
      if (length === null || length <= limit) {
        return []
      }
      return [
        offender(ERROR_CODES.TEXT_TOO_LONG, table, row, column, {
          length,
          limit
        })
      ]
    })
  )
}

function lengthErrors(db, tables) {
  return tables.flatMap((table) => overLimitErrors(db, table))
}

// The whitespace SQL trims from a value: the characters String.prototype.trim()
// removes, so a value is measured here as characterCount measures it. SQLite's
// trim() alone removes only spaces. They are the ASCII whitespace, the
// no-break space, the Unicode space separators, the line and paragraph
// separators and the byte order mark.
const TRIMMED_CHARACTERS =
  '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006' +
  '\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
const BLANK_CHARACTERS = `char(${Array.from(TRIMMED_CHARACTERS, (character) => character.codePointAt(0)).join(', ')})`

/** SQL that is true where `column` holds a value that is not blank. */
function notBlankSql(column) {
  const value = quoteSqliteIdent(column)
  return `${value} IS NOT NULL AND trim(CAST(${value} AS TEXT), ${BLANK_CHARACTERS}) <> ''`
}

/**
 * The values of a drop-down or filled-in column that its lists do not
 * offer. Each distinct value is checked against the lists once; the rows
 * are then read one at a time, and those that hold a refused value become
 * errors. Every value fits its limit by now.
 */
function notAllowedErrors(db, table, column, allowed) {
  const value = quoteSqliteIdent(column)
  const from = `FROM ${quoteSqliteIdent(table.name)} WHERE ${notBlankSql(column)}`
  const refused = db
    .prepare(
      `SELECT DISTINCT typeof(${value}) = 'blob' AS isBlob, CAST(${value} AS TEXT) AS value ${from}`
    )
    .all()
    .filter(
      (row) =>
        row.isBlob ||
        (!isNullWord(row.value) && !allowed.has(normaliseListValue(row.value)))
    )
  if (refused.length === 0) {
    return []
  }
  // The refused values are matched in JavaScript, not bound into the SQL: a
  // column can hold more distinct values than SQLite allows variables.
  const refusedTexts = new Set(
    refused.filter((row) => !row.isBlob).map((row) => row.value)
  )
  const textValueSql = `CASE WHEN typeof(${value}) = 'blob' THEN NULL ELSE CAST(${value} AS TEXT) END AS value`
  const errors = []
  for (const row of db
    .prepare(`${rowSelect(table, textValueSql)} ${from}`)
    .iterate()) {
    if (row.value !== null && !refusedTexts.has(row.value)) {
      continue
    }
    // A value that is not text has nothing to show: null.
    errors.push(
      offender(ERROR_CODES.VALUE_NOT_ALLOWED, table, row, column, {
        value: row.value === null ? null : shownValue(row.value.trim())
      })
    )
  }
  return errors
}

// A UUID as SQLite's GLOB matches it: groups of 8, 4, 4, 4 and 12
// hexadecimal digits.
const HEX = '[0-9a-fA-F]'
const UUID_SHAPE = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
const UUID_GLOB = UUID_SHAPE.replaceAll('x', HEX)

/** The rows whose `column` is not blank and is not a UUID, found in SQL. */
function uuidErrors(db, table, column, code) {
  const value = quoteSqliteIdent(column)
  return db
    .prepare(
      `${rowSelect(table)} FROM ${quoteSqliteIdent(table.name)} WHERE ${notBlankSql(column)} AND NOT (typeof(${value}) = 'text' AND trim(${value}, ${BLANK_CHARACTERS}) GLOB '${UUID_GLOB}')`
    )
    .all()
    .map((row) => offender(code, table, row, column))
}

// The start of a parent_geom as SQL reads it: enough for its type name.
const PARENT_GEOM_HEAD_CHARS = 32
// A WKT type name, in any case, and what may follow it.
const WKT_TYPE =
  /^(MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|POINT|LINESTRING|POLYGON)(?=[\s(]|EMPTY|$)/i
const GEOJSON_TYPES = Object.freeze({
  POINT: 'Point',
  MULTIPOINT: 'MultiPoint',
  LINESTRING: 'LineString',
  MULTILINESTRING: 'MultiLineString',
  POLYGON: 'Polygon',
  MULTIPOLYGON: 'MultiPolygon'
})

/** Whether the start of a parent_geom names one of the shapes the table holds. */
function namesParentShape(head, shapes) {
  const name = WKT_TYPE.exec(head.trim())?.[1]?.toUpperCase()
  return name !== undefined && shapes.includes(GEOJSON_TYPES[name])
}

/**
 * The parent_geom values that do not name the table's shape, or are longer
 * than the lineage check reads. Only the start of each is read, and nothing
 * is parsed: this runs before the upload's worker and memory reservation,
 * and the lineage check (parent-links.js), which runs in the worker, parses
 * the whole WKT and refuses one it cannot read.
 */
function parentGeomErrors(db, table) {
  const shapes = PARENT_SHAPES[table.geometryType] ?? []
  const value = quoteSqliteIdent(PARENT_GEOM)
  const extra = [
    `substr(trim(CAST(${value} AS TEXT), ${BLANK_CHARACTERS}), 1, ${PARENT_GEOM_HEAD_CHARS}) AS head`,
    `typeof(${value}) = 'blob' AS isBlob`,
    `length(CAST(${value} AS TEXT)) > ${MAX_PARENT_GEOM_CHARS} AS overCap`
  ].join(', ')
  const errors = []
  for (const row of db
    .prepare(
      `${rowSelect(table, extra)} FROM ${quoteSqliteIdent(table.name)} WHERE ${notBlankSql(PARENT_GEOM)}`
    )
    .iterate()) {
    if (!row.isBlob && !row.overCap && namesParentShape(row.head, shapes)) {
      continue
    }
    errors.push(
      offender(ERROR_CODES.PARENT_GEOM_INVALID, table, row, PARENT_GEOM, {
        shape: table.geometryType.toLowerCase()
      })
    )
  }
  return errors
}

function hasColumn(table, name) {
  return table.columns.some((column) => columnKey(column) === columnKey(name))
}

function contentErrors(db, tables) {
  return tables.flatMap((table) => {
    const isRedLine = columnKey(table.name) === RED_LINE_KEY
    const allowed = isRedLine
      ? []
      : table.columns.flatMap((column) => {
          const values = allowedValuesOf(column)
          return values === null
            ? []
            : notAllowedErrors(db, table, column, values)
        })
    return [
      ...allowed,
      ...(hasColumn(table, FEATURE_UUID)
        ? uuidErrors(db, table, FEATURE_UUID, ERROR_CODES.FEATURE_UUID_INVALID)
        : []),
      ...(hasColumn(table, PARENT_UUID)
        ? uuidErrors(db, table, PARENT_UUID, ERROR_CODES.PARENT_UUID_INVALID)
        : []),
      ...(hasColumn(table, PARENT_GEOM) ? parentGeomErrors(db, table) : [])
    ]
  })
}

// What each code's error says in the service's log. The frontend words it
// for the user, from its details.
const LOG_HEADINGS = Object.freeze({
  [ERROR_CODES.TEXT_TOO_LONG]: 'Text values longer than their column allows',
  [ERROR_CODES.VALUE_NOT_ALLOWED]: "Values not in their column's lists",
  [ERROR_CODES.FEATURE_UUID_INVALID]: 'feature_uuid values that are not UUIDs',
  [ERROR_CODES.PARENT_UUID_INVALID]: 'parent_uuid values that are not UUIDs',
  [ERROR_CODES.PARENT_GEOM_INVALID]:
    "parent_geom values that are not WKT of their table's shape"
})

const rowLabel = (fid) => `row ${fid}`

function logLabel({ table, ref, fid, column }) {
  return `${table} ${ref ?? rowLabel(fid)} ${column}`
}

/**
 * One error for each code, as the drop-out page shows one heading for each
 * problem: `details.count` values fail, and `details.sample` names the first
 * SAMPLE_CAP of them.
 *
 * @param {Array<{ code: string }>} offenders
 */
function collatedByCode(offenders) {
  const byCode = Map.groupBy(offenders, (entry) => entry.code)
  return [...byCode].map(([code, entries]) => {
    const sample = entries
      .slice(0, SAMPLE_CAP)
      .map(({ code: _code, ...entry }) => entry)
    const more =
      entries.length > sample.length
        ? ` (and ${entries.length - sample.length} more)`
        : ''
    return makeError(
      code,
      `${LOG_HEADINGS[code]}: ${sample.map(logLabel).join(', ')}${more}`,
      { count: entries.length, sample }
    )
  })
}

/**
 * Check the text values of an uploaded file's tables.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {(table: string) => boolean} includeTable which feature tables this
 *   upload reads
 * @returns {Array<{ code: string, message: string, details?: object }>} empty
 *   when every value passes
 */
export function checkTextValues(db, includeTable) {
  const tables = featureTables(db, includeTable)
  const tooLong = lengthErrors(db, tables)
  if (tooLong.length > 0) {
    return collatedByCode(tooLong)
  }
  return collatedByCode(contentErrors(db, tables))
}
