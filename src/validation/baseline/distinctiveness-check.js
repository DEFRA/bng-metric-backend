import { ERROR_CODES, makeError } from './errors.js'
import { getDistinctiveness } from './reference/habitat-distinctiveness.js'

// BMD-352 / MVS scope: only Medium, Low and Very Low distinctiveness habitats
// are accepted. High and Very High are rejected with one aggregate error
// listing every offending parcel.
const OUT_OF_SCOPE_BANDS = new Set(['High', 'V.High'])

const SAMPLE_CAP = 50

const HABITAT_TYPE_KEYS = ['Baseline Habitat Type', 'Baseline_Habitat_Type']
const PARCEL_REF_KEYS = ['Parcel Ref', 'Parcel_Ref', 'parcel_ref']

function pickProp(properties, candidates) {
  if (!properties) {
    return null
  }
  for (const key of candidates) {
    if (key in properties && properties[key] != null) {
      return properties[key]
    }
  }
  const lowered = new Map(
    Object.keys(properties).map((k) => [k.toLowerCase(), k])
  )
  for (const key of candidates) {
    const hit = lowered.get(key.toLowerCase())
    if (hit && properties[hit] != null) {
      return properties[hit]
    }
  }
  return null
}

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
    const habitatType = pickProp(props, HABITAT_TYPE_KEYS)
    const band = getDistinctiveness(habitatType)
    if (band && OUT_OF_SCOPE_BANDS.has(band)) {
      offenders.push({
        idx,
        fid: props.fid != null ? String(props.fid) : null,
        feature_ref: pickProp(props, PARCEL_REF_KEYS),
        habitat_type: habitatType,
        distinctiveness: band
      })
    }
  })

  if (offenders.length === 0) {
    return null
  }

  const sample = offenders.slice(0, SAMPLE_CAP)
  const details = { count: offenders.length, sample }

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
