// Refuse a post-intervention file whose baseline has an incomplete area
// habitat, hedgerow or watercourse (BMD-1195).
//
// A post-intervention upload replaces the project baseline with the one the
// file describes, and once a post-intervention file is uploaded the baseline
// can no longer be edited (BMD-1194). An incomplete baseline habitat saved
// then could never be completed, so the file is refused and the user fixes
// it there. A baseline-only upload still saves incomplete habitats as
// Incomplete, for the user to complete in the service (BMD-482).

import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'
import { ERROR_CODES, makeError } from '../errors.js'
import { SAMPLE_CAP, describeOffender, labelOffender } from '../offenders.js'

/** The baseline layers this check covers: the ones the story names. */
const BASELINE_LAYERS = Object.freeze(['habitats', 'hedgerows', 'watercourses'])

const MESSAGE =
  'One or more baseline habitats are incomplete, so this post-intervention file cannot replace the project baseline'

function offender(layer, feature, idx) {
  return {
    ...describeOffender(layer, feature, idx),
    feature_ref: feature.ref ?? null,
    habitat_type: feature.type ?? null
  }
}

function label(offending) {
  return offending.feature_ref == null || offending.feature_ref === ''
    ? labelOffender(offending)
    : `Feature Ref ${offending.feature_ref}`
}

/**
 * Check every area habitat, hedgerow and watercourse of the baseline a
 * post-intervention file is saved with, and refuse the file if any is
 * Incomplete. Status is what enrichment gave it (BMD-482): Incomplete when an
 * attribute its units need is missing or its units cannot be calculated.
 * Created rows have no baseline habitat, so they are not in this document.
 *
 * @param {object | undefined} baselineDocument the enriched baseline
 * @returns {{ code: string, message: string, details: { count: number, sample: object[] } } | null}
 *   one error for every incomplete habitat together, or null when there are none
 */
export function refuseIncompleteBaselines(baselineDocument) {
  const offenders = BASELINE_LAYERS.flatMap((layer) =>
    (baselineDocument?.[layer] ?? []).flatMap((feature, idx) =>
      feature?.status === HABITAT_STATUS.INCOMPLETE
        ? [offender(layer, feature, idx)]
        : []
    )
  )
  if (offenders.length === 0) {
    return null
  }
  const sample = offenders.slice(0, SAMPLE_CAP)
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''
  return makeError(
    ERROR_CODES.BASELINE_HABITATS_INCOMPLETE,
    `${MESSAGE}: ${sample.map(label).join(', ')}${more}`,
    { count: offenders.length, sample }
  )
}
