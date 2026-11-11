import { ERROR_CODES } from './errors.js'
import { collated, describeOffender, hasInvalidUtf8Text } from './offenders.js'
import { PROP_KEYS, pickProp } from './properties.js'
import { LONG_TEXT_LIMIT } from './text-limits.js'

// The same labels deriveRetentionCategory persists. This module lives in the
// shared validation root, which must not import a flow's enrichment folder, so
// the two labels and the "N. " prefix strip are repeated here rather than
// imported from retention-category.js.
const RETENTION_CREATED = 'Created'
const RETENTION_ENHANCED = 'Enhanced'

/**
 * Comment rules shared with the feature edit route (BMD-1112), which takes a
 * comment typed into the baseline habitat details page. Length is counted in
 * Unicode code points (`commentLength`), not UTF-16 code units: Joi's
 * `.max()` would count an emoji as two and refuse a comment the upload path
 * accepts.
 *
 * The longest comment the service accepts, in characters, once leading and
 * trailing whitespace has been removed: the limit an upload's text-value
 * check gives a comment (text-limits.js, BMD-1175).
 */
export const MAX_COMMENT_LENGTH = LONG_TEXT_LIMIT

const INVALID_CHARACTERS_HEADING =
  'One or more comments contain characters that are not valid UTF-8'

/**
 * Layers that carry a comment. Area and tree habitats spell the column
 * Comment; hedgerows and watercourses spell it Comments. A layer with no
 * comment column, such as watercourses through meanders, simply has nothing
 * to check.
 */
const COMMENT_LAYERS = Object.freeze([
  'areas',
  'verticalHabitats',
  'hedgerows',
  'watercourses',
  'trees'
])

// A CR, or a CRLF pair. A browser newline-normalises a textarea's value to
// CRLF when it submits the form, so the feature edit route would otherwise
// store a line break as two characters where an upload stores it as one.
const CARRIAGE_RETURN = /\r\n?/g

/**
 * A comment as the service stores it: line breaks as LF, leading and trailing
 * whitespace removed, and a blank one stored as null. Characters within the
 * text are kept, including spaces. A value that is not text is null. An
 * over-long comment never reaches here: the upload is refused before anything
 * is read, and an edit by its route.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function cleanComment(value) {
  const text = commentText(value)
  if (text == null) {
    return null
  }
  const trimmed = text.replaceAll(CARRIAGE_RETURN, '\n').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The comment saved on a baseline habitat.
 *
 * A legacy row holds both stages. When this upload also saves a
 * post-intervention document, an Enhanced or Created comment belongs there,
 * so the baseline derived from that row has none. A baseline-only upload
 * saves no post-intervention document, so the comment stays here. A BNG
 * Service template file has its own Comment on the Baseline tables, so it
 * always stays.
 *
 * @param {object} props
 * @param {{ sharesRowWithPostIntervention?: boolean }} [options]
 *   `sharesRowWithPostIntervention` is a legacy combined upload: one row is
 *   saved as both documents.
 * @returns {string | null}
 */
export function commentForBaseline(
  props,
  { sharesRowWithPostIntervention = false } = {}
) {
  if (
    sharesRowWithPostIntervention &&
    commentBelongsToPostIntervention(props)
  ) {
    return null
  }
  return cleanComment(commentOf(props))
}

/**
 * The comment saved on a post-intervention habitat.
 *
 * A legacy file has one comment column. Only an Enhanced or Created row's
 * comment belongs here; a Retained habitat shares the comment on its
 * baseline habitat, and a Lost row's comment stays on the baseline. A BNG
 * Service template file has its own Comment on each Post-Intervention
 * table, including a Retained row, so every retention category keeps it.
 *
 * Editing a baseline habitat's comment (BMD-1112) writes to the baseline
 * feature alone: a Retained row's own stored copy, which only a template
 * upload ever sets, is deliberately left as imported rather than overwritten
 * by an edit the user made elsewhere.
 *
 * Nothing resolves the two today, so a retained habitat's displayed comment
 * is whichever document the reader looked at. In a legacy upload only the
 * baseline carries one, so an edit is the only comment there is. In a
 * template upload both sides carry their own, and after a baseline edit they
 * differ — which is what the template's per-table Comment column is for. The
 * PDF report prints each side's own recorded comment by design
 * (`services/report/site-data.js` `recorded()`), so it shows the imported
 * text on a retained post-intervention card. Any screen or report that should
 * instead echo the edited baseline comment on a retained row has to resolve
 * the post-intervention row's baseline parent, and that join is neither a
 * featureId nor a unique ref — see the header of
 * `utilities/enrichment/post-intervention/resync-post-intervention-baseline.js`
 * for what resolving it actually takes.
 *
 * @param {object} props
 * @param {{ template?: boolean }} [options] `template` is a BNG Service template file
 * @returns {string | null}
 */
export function commentForPostIntervention(props, { template = false } = {}) {
  if (template || commentBelongsToPostIntervention(props)) {
    return cleanComment(commentOf(props))
  }
  return null
}

/**
 * Refuse a file whose comments are not valid UTF-8: one error for every
 * habitat it applies to. A null, empty or whitespace-only comment is allowed.
 * A comment's length is checked earlier, with every other text value, by
 * text-values-gate.js.
 *
 * @param {object} layers Output of readGeoPackage
 * @returns {Array<{ code: string, message: string, details: object }>}
 */
export function checkHabitatComments(layers) {
  const invalid = []
  const tables = layers?.layerTables
  for (const layer of COMMENT_LAYERS) {
    collectCommentOffenders(layers?.[layer], layer, tables?.[layer], invalid)
  }
  return [
    collated(
      ERROR_CODES.COMMENT_INVALID_CHARACTERS,
      INVALID_CHARACTERS_HEADING,
      invalid
    )
  ].filter(Boolean)
}

/**
 * @param {object[] | undefined} features
 * @param {string} layer
 * @param {string | undefined} table
 * @param {object[]} invalid
 */
function collectCommentOffenders(features, layer, table, invalid) {
  ;(features ?? []).forEach((feature, idx) => {
    recordComment(
      feature,
      describeOffender(layer, feature, idx, table),
      invalid
    )
  })
}

/**
 * @param {object} feature
 * @param {object} offender
 * @param {object[]} invalid
 */
function recordComment(feature, offender, invalid) {
  const raw = commentOf(feature?.properties)
  if (isBlankComment(raw)) {
    return
  }
  const text = commentText(raw)
  if (text == null || hasInvalidUtf8Text(text)) {
    invalid.push(offender)
  }
}

/**
 * @param {object | undefined} props
 * @returns {unknown}
 */
function commentOf(props) {
  return pickProp(props ?? {}, PROP_KEYS.comment)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isBlankComment(value) {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

/**
 * Text a comment can be measured and stored as. A number is its digits. Bytes
 * SQLite returned as a BLOB are not text.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function commentText(value) {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return null
}

/**
 * Characters after line breaks are put back to LF and leading and trailing
 * whitespace is removed — the text as {@link cleanComment} would store it, so
 * a comment the length check passes is a comment that fits. Shared with the
 * feature edit route, which must not use Joi's UTF-16 `.max()`.
 *
 * @param {string} text
 * @returns {number}
 */
export function commentLength(text) {
  return Array.from(text.replaceAll(CARRIAGE_RETURN, '\n').trim()).length
}

/**
 * Enhanced and Created comments are the post-intervention habitat's own.
 * Lost is not: an area Lost row is later stored as Created, but its comment
 * describes the baseline habitat that was lost.
 *
 * @param {object | undefined} props
 * @returns {boolean}
 */
function commentBelongsToPostIntervention(props) {
  const category = retentionLabel(
    pickProp(props ?? {}, PROP_KEYS.retentionCategory)
  )
  return category === RETENTION_ENHANCED || category === RETENTION_CREATED
}

/**
 * The Retention Category cell, without a leading "N. " list prefix. "Lost"
 * stays "Lost": an area Lost row is stored as Created later, but that mapping
 * does not decide where its comment goes.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function retentionLabel(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  const prefixEnd = indexAfterLeadingDigits(trimmed)
  if (prefixEnd > 0 && trimmed[prefixEnd] === '.') {
    return trimmed.slice(prefixEnd + 1).trim()
  }
  return trimmed
}

/**
 * @param {string} text
 * @returns {number}
 */
function indexAfterLeadingDigits(text) {
  let index = 0
  while (index < text.length && isAsciiDigit(text[index])) {
    index += 1
  }
  return index
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isAsciiDigit(char) {
  return char >= '0' && char <= '9'
}
