import { ERROR_CODES, makeError } from './errors.js'
import { PROP_KEYS, buildHabitatLookupKey, pickProp } from './properties.js'
import {
  distinctivenessScores,
  getDistinctiveness
} from './reference/habitat-distinctiveness.js'

// BMD-352 / MVS scope: only Medium, Low and Very Low distinctiveness habitats
// are accepted. High and Very High are rejected with one aggregate error
// listing every offending parcel.
const OUT_OF_SCOPE_BANDS = new Set(['High', 'V.High'])

const SAMPLE_CAP = 50

// Derive the allowed-band ID list from the reference data so it can never
// drift from OUT_OF_SCOPE_BANDS. The frontend owns the display-name mapping
// ("V.Low" → "Very low") since it already maintains that vocabulary for the
// offender lines; we just publish the raw IDs as structured details.
// Bands appear in their reference order (highest → lowest score).
const ALLOWED_BANDS = Object.keys(distinctivenessScores).filter(
  (band) => !OUT_OF_SCOPE_BANDS.has(band)
)

function describeFeature(sample) {
  if (sample?.feature_ref) {
    return `Feature Ref ${sample.feature_ref}`
  }
  if (sample?.fid != null && sample.fid !== '') {
    return `fid ${sample.fid}`
  }
  if (sample?.idx != null) {
    return `feature #${sample.idx}`
  }
  return 'feature'
}

function formatList(prefix, count, sample) {
  const shown = sample.map(describeFeature).join(', ')
  if (count > sample.length) {
    return `${prefix}: ${shown} (and ${count - sample.length} more)`
  }
  return `${prefix}: ${shown}`
}

/**
 * Scan the area habitats layer and produce a single error listing every
 * habitat whose distinctiveness band falls outside the MVS scope (i.e. High or
 * Very High). Returns `null` when every habitat is in scope (or when the layer
 * is empty — that case is the NO_HABITAT_AREAS geometry check's concern).
 *
 * Unknown habitat types — those not present in the reference table — are
 * passed through; the schema check upstream is responsible for catching them.
 *
 * @param {object} layers Output of readBaselineGeoPackage
 * @returns {{ code: string, message: string, details: object }|null}
 */
export function checkBaselineDistinctiveness(layers) {
  const features = layers?.areas ?? []
  const offenders = []
  features.forEach((feature, idx) => {
    const props = feature?.properties ?? {}
    const habitatType = buildHabitatLookupKey(props)
    const band = getDistinctiveness(habitatType)
    if (band && OUT_OF_SCOPE_BANDS.has(band)) {
      const rawFid = pickProp(props, PROP_KEYS.fid)
      offenders.push({
        idx,
        fid: rawFid == null ? null : String(rawFid),
        feature_ref: pickProp(props, PROP_KEYS.parcelRef),
        habitat_type: habitatType,
        distinctiveness: band
      })
    }
  })

  if (offenders.length === 0) {
    return null
  }

  const sample = offenders.slice(0, SAMPLE_CAP)
  const details = {
    count: offenders.length,
    sample,
    allowedBands: ALLOWED_BANDS
  }

  return makeError(
    ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
    formatList(
      'One or more habitats have a distinctiveness that is out of scope for the BNG Beta service',
      offenders.length,
      sample
    ),
    details
  )
}
