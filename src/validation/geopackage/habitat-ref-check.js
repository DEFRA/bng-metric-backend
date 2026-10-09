import { ERROR_CODES, makeError } from './errors.js'
import { PROP_KEYS, pickProp } from './properties.js'

/**
 * The longest habitat reference the service keeps. A longer one is truncated
 * on save rather than rejected (BMD-1058). The QGIS template declares the
 * column TEXT(99), but SQLite does not enforce it, so a file can carry more.
 */
export const MAX_HABITAT_REF_LENGTH = 100

const SAMPLE_CAP = 50

/**
 * The character a UTF-8 decoder puts in place of bytes that are not valid
 * UTF-8. better-sqlite3 decodes TEXT values with V8's decoder, so a reference
 * holding invalid UTF-8 reaches us with this in it.
 */
const REPLACEMENT_CHARACTER = '�'

/**
 * The layers whose references these rules cover: every layer that uses the
 * Parcel Ref column. Trees use Tree Ref and are not covered (BMD-1058).
 */
export const HABITAT_REF_LAYERS = Object.freeze([
  'areas',
  'hedgerows',
  'watercourses'
])

/**
 * A reference as the service stores it: trimmed, then cut to
 * MAX_HABITAT_REF_LENGTH characters, then trimmed again so a cut that lands
 * on a space leaves none behind and cleaning a cleaned reference changes
 * nothing. Characters are counted as code points, so a cut never splits one.
 * A value that is not text is returned as it is.
 *
 * @param {unknown} ref
 * @returns {unknown}
 */
export function cleanHabitatRef(ref) {
  if (typeof ref !== 'string' && typeof ref !== 'number') {
    return ref
  }
  const trimmed = String(ref).trim()
  const characters = Array.from(trimmed)
  if (characters.length <= MAX_HABITAT_REF_LENGTH) {
    return trimmed
  }
  return characters.slice(0, MAX_HABITAT_REF_LENGTH).join('').trimEnd()
}

function isMissing(ref) {
  return ref == null || (typeof ref === 'string' && ref.trim() === '')
}

/**
 * A reference that is not UTF-8 text: one the decoder had to repair, or a
 * value SQLite returned as bytes (a BLOB) rather than as text.
 */
function hasInvalidCharacters(ref) {
  if (typeof ref === 'string') {
    return ref.includes(REPLACEMENT_CHARACTER)
  }
  return typeof ref !== 'number'
}

function describe(layer, feature, idx) {
  const fid = pickProp(feature?.properties ?? {}, PROP_KEYS.fid)
  return fid == null || fid === '' ? { layer, idx } : { layer, idx, fid }
}

function labelOf({ layer, fid, idx }) {
  return fid == null ? `${layer} feature #${idx}` : `${layer} fid ${fid}`
}

/**
 * One error for every offending habitat together, as the dropout page shows
 * one message for them all rather than one per habitat.
 */
function collated(code, heading, offenders) {
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
    `${heading}: ${sample.map(labelOf).join(', ')}${more}`,
    { count: offenders.length, sample }
  )
}

/**
 * Check every habitat's Parcel Ref on the area, hedgerow and watercourse
 * layers (BMD-1058):
 *
 * - every habitat must have one: a missing or blank reference is
 *   HABITAT_REF_MISSING;
 * - it must be UTF-8 text: one with characters that are not is
 *   HABITAT_REF_INVALID_CHARACTERS.
 *
 * Each is one error for all the habitats it applies to. Habitats may share a
 * reference, and a long one is truncated on save (cleanHabitatRef), so
 * neither is an error.
 *
 * @param {object} layers Output of readGeoPackage
 * @returns {Array<{ code: string, message: string, details: { count: number, sample: object[] } }>}
 */
export function checkHabitatRefs(layers) {
  const missing = []
  const invalid = []
  for (const layer of HABITAT_REF_LAYERS) {
    const features = layers?.[layer] ?? []
    features.forEach((feature, idx) => {
      const ref = pickProp(feature?.properties ?? {}, PROP_KEYS.parcelRef)
      if (isMissing(ref)) {
        missing.push(describe(layer, feature, idx))
      } else if (hasInvalidCharacters(ref)) {
        invalid.push(describe(layer, feature, idx))
      }
    })
  }
  return [
    collated(
      ERROR_CODES.HABITAT_REF_MISSING,
      'Every habitat must have a Parcel Ref',
      missing
    ),
    collated(
      ERROR_CODES.HABITAT_REF_INVALID_CHARACTERS,
      'One or more Parcel Refs contain characters that are not valid UTF-8',
      invalid
    )
  ].filter(Boolean)
}
