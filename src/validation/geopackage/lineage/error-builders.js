// User-facing errors for the staged GeoPackage format.
//
// Deliberately shaped like the geometry errors in ../postgis/error-builders.js:
// one error object per code, a message that names the offenders, and a
// `details` payload carrying the truthful `count` plus a capped `sample`. Both
// error sets arrive in the same response array, so a caller that can render one
// can render the other without a second code path.
//
// Sample keys stay snake_case for the same reason — every existing
// `details.sample` entry comes straight out of PostGIS, and a response mixing
// `feature_ref` with `featureRef` would be a trap for whoever consumes it.

import { ERROR_CODES, makeError } from '../errors.js'
import { ERROR_LIST_SAMPLE_CAP } from '../postgis/constants.js'
import { formatList } from '../postgis/error-builders.js'
import { HABITAT_TYPES } from './staged-layer-names.js'

/** Digits used when a size appears in an error message. */
const SIZE_MESSAGE_DECIMALS = 2

/**
 * Habitat type → the words a surveyor would use for it. The internal keys
 * (`verticalAreas`) are not something to put in front of a user.
 */
const TYPE_LABELS = Object.freeze({
  [HABITAT_TYPES.AREAS]: 'area habitats',
  [HABITAT_TYPES.VERTICAL_AREAS]: 'vertical area habitats',
  [HABITAT_TYPES.HEDGEROWS]: 'hedgerows',
  [HABITAT_TYPES.WATERCOURSES]: 'watercourses',
  [HABITAT_TYPES.TREES]: 'trees'
})

/** Measure name → the unit its totals are quoted in. */
const MEASURE_UNITS = Object.freeze({
  area: 'sq m',
  length: 'm'
})

/**
 * @param {string} type
 * @returns {string}
 */
export function typeLabel(type) {
  return TYPE_LABELS[type] ?? type
}

/**
 * Wrap a list of samples into the `{ count, sample }` payload the existing
 * error details use. The count is the truthful total; the sample is capped so a
 * file with thousands of offenders cannot blow up the response.
 *
 * @param {object[]} samples
 * @returns {{ count: number, sample: object[] }}
 */
function listPayload(samples) {
  return {
    count: samples.length,
    sample: samples.slice(0, ERROR_LIST_SAMPLE_CAP)
  }
}

function describePiFeature(sample) {
  const label = typeLabel(sample?.type)
  return sample?.pi_ref ? `${label} ${sample.pi_ref}` : `${label} feature`
}

function describeUnknownParent(sample) {
  return `${describePiFeature(sample)} → "${sample?.parent_ref}"`
}

function describeEscape(sample) {
  const unit = MEASURE_UNITS[sample?.measure] ?? ''
  const escape = Number(sample?.escape_size ?? 0).toFixed(SIZE_MESSAGE_DECIMALS)
  return `${describePiFeature(sample)} escapes "${sample?.parent_ref}" by ~${escape} ${unit}`.trim()
}

function describeSizeMismatch(sample) {
  const unit = MEASURE_UNITS[sample?.measure] ?? ''
  const baseline = Number(sample?.baseline_total ?? 0).toFixed(
    SIZE_MESSAGE_DECIMALS
  )
  const pi = Number(sample?.pi_total ?? 0).toFixed(SIZE_MESSAGE_DECIMALS)
  return `${typeLabel(sample?.type)} — baseline ${baseline} ${unit} vs post-intervention ${pi} ${unit}`
}

/** Counts read as whole trees; areas and lengths keep their decimals. */
function formatSize(measure, value) {
  const size = Number(value ?? 0)
  return measure === 'count'
    ? String(Math.round(size))
    : size.toFixed(SIZE_MESSAGE_DECIMALS)
}

function describeRemoval(sample) {
  const unit = MEASURE_UNITS[sample?.measure] ?? ''
  const removed = formatSize(sample?.measure, sample?.removed_size)
  return `${typeLabel(sample?.type)} "${sample?.parent_ref}" — ${removed} ${unit} with no post-intervention continuation`
    .replaceAll('  ', ' ')
    .trim()
}

function describeOversubscription(sample) {
  const unit = MEASURE_UNITS[sample?.measure] ?? ''
  const baseline = formatSize(sample?.measure, sample?.baseline_size)
  const pi = formatSize(sample?.measure, sample?.pi_size)
  return `${typeLabel(sample?.type)} "${sample?.parent_ref}" — children total ${pi} ${unit} against a baseline of ${baseline} ${unit}`
    .replaceAll('  ', ' ')
    .trim()
}

/**
 * A post-intervention layer with no baseline counterpart. Nothing can be
 * reconciled against it, and the units it claims cannot be checked, so this is
 * blocking rather than advisory.
 *
 * @param {string[]} types habitat types missing their baseline layer
 */
export function stagedMissingBaselineLayerError(types) {
  const payload = listPayload(types.map((type) => ({ type })))
  return makeError(
    ERROR_CODES.STAGED_MISSING_BASELINE_LAYER,
    formatList(
      'Post-intervention layers have no matching baseline layer',
      payload,
      (sample) => typeLabel(sample?.type)
    ),
    payload
  )
}

/**
 * A stamped `Parent Ref` naming nothing in the baseline. Left unreported this
 * degrades silently: deriveLineage falls through to the geometry rule and the
 * feature acquires a plausible-looking parent it was never meant to have.
 *
 * @param {Array<{ type: string, pi_ref: string|null, parent_ref: string }>} samples
 */
export function stagedUnknownParentRefError(samples) {
  const payload = listPayload(samples)
  return makeError(
    ERROR_CODES.STAGED_UNKNOWN_PARENT_REF,
    formatList(
      'One or more post-intervention features name a parent that is not in the baseline',
      payload,
      describeUnknownParent
    ),
    payload
  )
}

/**
 * @param {Array<{ type: string, pi_ref: string|null, parent_ref: string, escape_size: number, measure: string }>} samples
 */
export function stagedPiOutsideParentError(samples) {
  const payload = listPayload(samples)
  return makeError(
    ERROR_CODES.STAGED_PI_OUTSIDE_PARENT,
    formatList(
      'One or more post-intervention features are not entirely within the baseline parcel they came from',
      payload,
      describeEscape
    ),
    payload
  )
}

/**
 * @param {Array<{ type: string, measure: string, baseline_total: number, pi_total: number, delta: number }>} samples
 */
export function stagedSizeMismatchError(samples) {
  const payload = listPayload(samples)
  return makeError(
    ERROR_CODES.STAGED_SIZE_MISMATCH,
    formatList(
      'Baseline and post-intervention totals do not match',
      payload,
      describeSizeMismatch
    ),
    payload
  )
}

/**
 * Children stamped to one parent totalling MORE than that parent. Blocking:
 * within-parent containment means length and area children cannot legitimately
 * outgrow their parent, so an excess is a duplicated or mis-stamped row, and
 * for trees a count exceeding the baseline point's count is simply wrong.
 *
 * @param {Array<{ type: string, parent_ref: string, measure: string, baseline_size: number, pi_size: number, excess: number }>} samples
 */
export function stagedParentOversubscribedError(samples) {
  const payload = listPayload(samples)
  return makeError(
    ERROR_CODES.STAGED_PARENT_OVERSUBSCRIBED,
    formatList(
      'One or more baseline features have post-intervention children totalling more than the baseline',
      payload,
      describeOversubscription
    ),
    payload
  )
}

/**
 * Baseline features the service will treat as (partly) removed because no
 * post-intervention child accounts for them. A WARNING, not an error: the
 * template's copy action populates post-intervention with every baseline
 * feature, so absence is a deliberate deletion — but the surveyor is told
 * what the calculation will assume, because absence is also what a slip of
 * the delete key looks like.
 *
 * @param {Array<{ type: string, parent_ref: string, measure: string, baseline_size: number, pi_size: number, removed_size: number }>} samples
 */
export function stagedFeaturesRemovedWarning(samples) {
  const payload = listPayload(samples)
  return makeError(
    ERROR_CODES.STAGED_FEATURES_REMOVED,
    formatList(
      'Baseline features with no post-intervention continuation will be treated as removed',
      payload,
      describeRemoval
    ),
    payload
  )
}
