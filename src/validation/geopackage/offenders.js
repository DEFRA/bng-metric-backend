import { makeError } from './errors.js'
import { PROP_KEYS, pickProp } from './properties.js'

/** How many offending features a collated error names before saying "and N more". */
export const SAMPLE_CAP = 50

/**
 * The character a UTF-8 decoder puts in place of bytes that are not valid
 * UTF-8. better-sqlite3 decodes TEXT values with V8's decoder, so invalid
 * UTF-8 reaches us with this in it.
 */
export const REPLACEMENT_CHARACTER = '�'

/**
 * Whether text holds characters that are not UTF-8: the replacement character
 * a decoder puts in place of invalid bytes, or a lone surrogate, which has no
 * UTF-8 encoding at all.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasInvalidUtf8Text(text) {
  return text.includes(REPLACEMENT_CHARACTER) || !text.isWellFormed()
}

/**
 * Where an offending feature sits, for the dropout page. A BNG Service
 * template file names its table; a legacy file names the layer. `fid` is
 * included when the row has one.
 *
 * @param {string} layer
 * @param {object} feature
 * @param {number} idx
 * @param {string} [table]
 * @returns {{ layer: string, table?: string, idx: number, fid?: unknown }}
 */
export function describeOffender(layer, feature, idx, table) {
  const fid = pickProp(feature?.properties ?? {}, PROP_KEYS.fid)
  const where = table ? { layer, table, idx } : { layer, idx }
  return fid == null || fid === '' ? where : { ...where, fid }
}

/**
 * A feature id as text. GeoPackage stores `fid` as an integer, and a
 * hand-edited file can store text. Anything else has no readable form.
 *
 * The casts keep the conversion off `unknown`. Interpolating `unknown`
 * stringifies an object as "[object Object]".
 *
 * @param {unknown} fid
 * @returns {string | null}
 */
function readableFid(fid) {
  switch (typeof fid) {
    case 'string':
      return /** @type {string} */ (fid)
    case 'number':
      return /** @type {number} */ (fid).toString()
    default:
      return null
  }
}

/**
 * @param {{ layer: string, table?: string, fid?: unknown, idx: number }} offender
 * @returns {string}
 */
export function labelOffender({ layer, table, fid, idx }) {
  const name = table ?? layer
  const id = readableFid(fid)
  return id == null ? `${name} feature #${idx}` : `${name} fid ${id}`
}

/**
 * One error for every offending feature together, as the dropout page shows
 * one message for them all rather than one per feature. Null when nothing
 * offended.
 *
 * @param {string} code
 * @param {string} heading
 * @param {Array<{ layer: string, table?: string, fid?: unknown, idx: number }>} offenders
 * @returns {{ code: string, message: string, details: { count: number, sample: object[] } } | null}
 */
export function collated(code, heading, offenders) {
  if (offenders.length === 0) {
    return null
  }
  const sample = offenders.slice(0, SAMPLE_CAP)
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''
  return makeError(
    code,
    `${heading}: ${sample.map(labelOffender).join(', ')}${more}`,
    { count: offenders.length, sample }
  )
}
