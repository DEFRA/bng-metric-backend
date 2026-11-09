import { HABITAT_REF } from 'bng-library/bng-service'

import { ERROR_CODES } from './errors.js'
import { describeOffender, collated, hasInvalidUtf8Text } from './offenders.js'
import { PROP_KEYS, pickProp } from './properties.js'
import { SHORT_TEXT_LIMIT, characterCount } from './text-limits.js'

/**
 * The longest habitat reference the service accepts, in characters, once
 * trimmed. A longer one is refused, not cut (BMD-1175): an upload by the
 * format gate (text-values-gate.js), and an edit by its route.
 */
export const MAX_HABITAT_REF_LENGTH = SHORT_TEXT_LIMIT

/**
 * Whether a reference is longer than MAX_HABITAT_REF_LENGTH characters once
 * trimmed.
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isHabitatRefTooLong(ref) {
  return characterCount(ref) > MAX_HABITAT_REF_LENGTH
}

/** The legacy template's name for a habitat's reference column. */
const LEGACY_REF_COLUMN = 'Parcel Ref'

/**
 * The layers whose references these rules cover: every layer that uses the
 * Parcel Ref column. Trees use Tree Ref and are not covered (BMD-1058).
 */
export const HABITAT_REF_LAYERS = Object.freeze([
  'areas',
  'verticalHabitats',
  'hedgerows',
  'watercourses'
])

/**
 * A reference as the service stores it: trimmed. A value that is not text is
 * returned as it is. A reference longer than MAX_HABITAT_REF_LENGTH never
 * reaches here: it is refused first.
 *
 * @param {unknown} ref
 * @returns {unknown}
 */
export function cleanHabitatRef(ref) {
  if (typeof ref !== 'string' && typeof ref !== 'number') {
    return ref
  }
  return String(ref).trim()
}

function isMissing(ref) {
  return ref == null || (typeof ref === 'string' && ref.trim() === '')
}

/**
 * Whether a text reference holds characters that are not UTF-8: the
 * replacement character a decoder puts in place of invalid bytes, or a lone
 * surrogate, which has no UTF-8 encoding at all. Shared with the feature edit
 * route, which takes a reference typed into the edit page (BMD-1061) — the
 * request decoder repairs invalid bytes the same way, and a JSON body can
 * still carry an escaped lone surrogate that Postgres would refuse to store.
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function hasInvalidRefCharacters(ref) {
  return hasInvalidUtf8Text(ref)
}

/**
 * A reference that is not UTF-8 text: one the decoder had to repair, or a
 * value SQLite returned as bytes (a BLOB) rather than as text.
 */
function hasInvalidCharacters(ref) {
  if (typeof ref === 'string') {
    return hasInvalidRefCharacters(ref)
  }
  return typeof ref !== 'number'
}

/**
 * Check every habitat's Parcel Ref on the area, vertical area, hedgerow and
 * watercourse layers (BMD-1058):
 *
 * - every habitat must have one: a missing or blank reference is
 *   HABITAT_REF_MISSING;
 * - it must be UTF-8 text: one with characters that are not is
 *   HABITAT_REF_INVALID_CHARACTERS.
 *
 * Each is one error for all the habitats it applies to. Habitats may share a
 * reference, which is not an error. A reference's length is checked by the
 * format gate, before this check (text-values-gate.js).
 *
 * @param {object} layers Output of readGeoPackage
 * @returns {Array<{ code: string, message: string, details: { count: number, sample: object[] } }>}
 */
export function checkHabitatRefs(layers) {
  const missing = []
  const invalid = []
  // A BNG Service template file names its tables, and calls the column Habitat
  // Ref; the messages use the file's own names.
  const tables = layers?.layerTables
  const refColumn = tables ? HABITAT_REF : LEGACY_REF_COLUMN
  for (const layer of HABITAT_REF_LAYERS) {
    const features = layers?.[layer] ?? []
    const table = tables?.[layer]
    features.forEach((feature, idx) => {
      const ref = pickProp(feature?.properties ?? {}, PROP_KEYS.parcelRef)
      // A missing reference has no characters to check, so it is reported
      // as missing only.
      if (isMissing(ref)) {
        missing.push(describeOffender(layer, feature, idx, table))
        return
      }
      if (hasInvalidCharacters(ref)) {
        invalid.push(describeOffender(layer, feature, idx, table))
      }
    })
  }
  return [
    collated(
      ERROR_CODES.HABITAT_REF_MISSING,
      `Every habitat must have a ${refColumn}`,
      missing
    ),
    collated(
      ERROR_CODES.HABITAT_REF_INVALID_CHARACTERS,
      `One or more ${refColumn}s contain characters that are not valid UTF-8`,
      invalid
    )
  ].filter(Boolean)
}
