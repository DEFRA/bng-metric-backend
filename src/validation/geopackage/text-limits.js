import { TEMPLATE_ALLOWED_VALUES } from 'bng-library/bng-service'

import { PROP_KEYS, PROPOSED_PROP_KEYS } from './properties.js'

/**
 * The longest text each column of an uploaded GeoPackage may hold, in
 * characters (Unicode code points, not bytes), once leading and trailing
 * whitespace is removed (BMD-1175). SQLite does not enforce a declared width
 * such as TEXT(99), so the service is the real check, for every upload and
 * for both templates.
 */
export const SHORT_TEXT_LIMIT = 99
export const LONG_TEXT_LIMIT = 999

/**
 * Spatial risk category is the one drop-down wider than 99 characters: two
 * intertidal values in the Metric's list are 101 and 115 characters long.
 */
export const SPATIAL_RISK_LIMIT = 255
const SPATIAL_RISK = 'Spatial risk category'

/**
 * The columns that name a feature or its parent: the BNG Service template's,
 * then the legacy template's.
 */
export const REF_COLUMNS = Object.freeze([
  'Habitat Ref',
  'Parcel Ref',
  'Tree Ref',
  'Baseline Parcel Ref'
])
const PARENT_REF = 'Parent Ref'

/** Free-text columns limited to 999 characters. Legacy habitats spell Comment as Comments. */
const LONG_TEXT_COLUMNS = Object.freeze([
  'Comment',
  'Comments',
  'Site Name',
  'Survey Details',
  'Mapped by',
  'Company',
  'Base Map'
])

/** Free-text columns limited to 99 characters, besides the drop-downs. */
const SHORT_TEXT_COLUMNS = Object.freeze([
  ...REF_COLUMNS,
  PARENT_REF,
  'Location'
])

/**
 * A column name as the checks compare it. The legacy template has a column
 * whose name ends in a space, and a file written by another tool can differ
 * in case.
 *
 * @param {string} column
 * @returns {string}
 */
export function columnKey(column) {
  return String(column).trim().toLowerCase()
}

// A legacy list number, as in "4. Fairly Poor": digits and a full stop not
// followed by another digit, so a decimal such as "5.0" keeps its digits.
const LIST_NUMBER = /^\d+\.(?!\d)\s*/
// A whole number of years written as a decimal, as in "5.0".
const WHOLE_DECIMAL = /^(\d+)\.0+$/
const WHITESPACE_RUN = /\s+/g
// Riparian encroachment pairs are spelt "Minor/ Minor" and "Minor/Minor".
const SLASH = '/'

/**
 * Every drop-down and filled-in column in either template, with the values
 * any of its lists offers (see allowedValuesOf).
 */
const ALLOWED_VALUES = new Map()
// Two names can be one column once compared: the legacy template spells one
// timing column with a trailing space. Their lists are joined, not replaced.
for (const [column, values] of Object.entries(TEMPLATE_ALLOWED_VALUES)) {
  const key = columnKey(column)
  const allowed = ALLOWED_VALUES.get(key) ?? new Set()
  for (const value of values) {
    allowed.add(normaliseListValue(value))
  }
  ALLOWED_VALUES.set(key, allowed)
}

const TEXT_LIMITS = new Map([
  ...[...ALLOWED_VALUES.keys()].map((key) => [key, SHORT_TEXT_LIMIT]),
  ...SHORT_TEXT_COLUMNS.map((column) => [columnKey(column), SHORT_TEXT_LIMIT]),
  ...LONG_TEXT_COLUMNS.map((column) => [columnKey(column), LONG_TEXT_LIMIT]),
  [columnKey(SPATIAL_RISK), SPATIAL_RISK_LIMIT]
])

// The legacy import reads a value from an alias when its template column is
// blank (pickProp, PROP_KEYS), such as Baseline_Condition or Comment_s. An
// alias is checked as its template column is, so no value reaches the import
// unchecked. An alias that names a column of its own is left as it is.
for (const aliases of [
  ...Object.values(PROP_KEYS),
  ...Object.values(PROPOSED_PROP_KEYS)
]) {
  const aliasKeys = aliases.map(columnKey)
  const known = aliasKeys.find((aliasKey) => TEXT_LIMITS.has(aliasKey))
  if (known === undefined) {
    continue
  }
  for (const alias of aliasKeys.filter(
    (aliasKey) => !TEXT_LIMITS.has(aliasKey)
  )) {
    TEXT_LIMITS.set(alias, TEXT_LIMITS.get(known))
    if (ALLOWED_VALUES.has(known)) {
      ALLOWED_VALUES.set(alias, ALLOWED_VALUES.get(known))
    }
  }
}

/**
 * The longest text a column may hold, or null for a column with no limit:
 * feature_uuid and parent_uuid, which are checked as UUIDs; parent_geom,
 * which is checked as WKT; and a column neither template has.
 *
 * @param {string} column
 * @returns {number | null}
 */
export function textLimitOf(column) {
  return TEXT_LIMITS.get(columnKey(column)) ?? null
}

/**
 * A value as the allowed-value check compares it: without a legacy list
 * number, with runs of whitespace as one space and none around a slash, in
 * lower case, and a whole number of years without its decimal places. A list's own values are
 * compared the same way, so "4. Fairly Poor", "Fairly Poor" and
 * "fairly poor" are all the same word.
 *
 * @param {string | number | null | undefined} value
 * @returns {string}
 */
export function normaliseListValue(value) {
  return String(value)
    .trim()
    .replace(LIST_NUMBER, '')
    .replaceAll(WHITESPACE_RUN, ' ')
    .split(SLASH)
    .map((part) => part.trim())
    .join(SLASH)
    .replace(WHOLE_DECIMAL, '$1')
    .toLowerCase()
}

/**
 * Whether a value is the word GIS tools write for a missing value, which
 * the checks treat as blank, as the later checks already do.
 *
 * @param {string | number | null | undefined} value
 * @returns {boolean}
 */
export function isNullWord(value) {
  return String(value).trim().toLowerCase() === 'null'
}

/**
 * The values a drop-down or filled-in column allows, normalised as
 * normaliseListValue normalises them, or null for a free-text column. The
 * values are those of every list either template offers for the column: the
 * check is that a value is one of the template's words at all, not that it
 * fits the rest of its row, which the later checks decide as before.
 *
 * @param {string} column
 * @returns {Set<string> | null}
 */
export function allowedValuesOf(column) {
  return ALLOWED_VALUES.get(columnKey(column)) ?? null
}

/** The marker on a value cut short for a message or a log. */
export const TRUNCATION_MARKER = '… (truncated)'

/**
 * A value from a file, safe to put in a message or a log: cut to 99
 * characters and marked as truncated when it is longer, so that no value,
 * however long, reaches either whole (BMD-1175 AC7). Characters are counted
 * as code points, so a cut never splits one.
 *
 * @param {string | number | null | undefined} value
 * @returns {string}
 */
export function shownValue(value) {
  const characters = Array.from(String(value ?? ''))
  return characters.length <= SHORT_TEXT_LIMIT
    ? characters.join('')
    : `${characters.slice(0, SHORT_TEXT_LIMIT).join('')}${TRUNCATION_MARKER}`
}

/**
 * A text's length in characters (code points), once leading and trailing
 * whitespace is removed: the length a limit is compared with.
 *
 * @param {string} text
 * @returns {number}
 */
export function characterCount(text) {
  return Array.from(text.trim()).length
}
