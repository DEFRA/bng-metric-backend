import { ERROR_CODES, makeError } from './errors.js'
import {
  EXTRACT_VARIANT,
  PROP_KEYS,
  buildHabitatLookupKey,
  featureKeysForVariant,
  pickProp
} from './properties.js'
import {
  distinctivenessScores,
  getDistinctiveness,
  getHedgerowDistinctiveness,
  getWatercourseDistinctiveness
} from '../reference/habitat-distinctiveness.js'

// MVS scope: only Medium, Low and Very Low distinctiveness habitats are
// accepted. High and Very High are rejected with one aggregate error listing
// every offending parcel. Exported so the feature-edit write path enforces the
// same invariant instead of re-declaring the band set.
export const OUT_OF_SCOPE_BANDS = new Set(['High', 'V.High'])

const SAMPLE_CAP = 50

// Derive the allowed-band ID list from the reference data so it can never
// drift from OUT_OF_SCOPE_BANDS. The frontend owns the display-name mapping
// ("V.Low" → "Very low") since it already maintains that vocabulary for the
// offender lines; we just publish the raw IDs as structured details.
// Bands appear in their reference order (highest → lowest score).
const ALLOWED_BANDS = Object.keys(distinctivenessScores).filter(
  (band) => !OUT_OF_SCOPE_BANDS.has(band)
)

// `idx` is always set (from the forEach below), so it's the terminal fallback.
function describeFeature(sample) {
  if (sample.feature_ref) {
    return `Feature Ref ${sample.feature_ref}`
  }
  if (sample.fid != null && sample.fid !== '') {
    return `fid ${sample.fid}`
  }
  return `feature #${sample.idx}`
}

function formatList(prefix, count, sample) {
  const shown = sample.map(describeFeature).join(', ')
  if (count > sample.length) {
    return `${prefix}: ${shown} (and ${count - sample.length} more)`
  }
  return `${prefix}: ${shown}`
}

// Resolve a linear (hedgerow / watercourse) habitat type from its single source
// column. Unlike area habitats — whose lookup key is the "<broad> - <type>"
// concatenation built by buildHabitatLookupKey — hedge and river types live in
// one column and are keyed on directly. Returns null when the column is empty.
function linearLookupKey(props, candidates) {
  const value = pickProp(props, candidates)
  return typeof value === 'string' && value.trim() ? value : null
}

// Scan one layer, appending an offender record for every feature whose
// distinctiveness band is out of scope. `getKey` derives the reference-table
// lookup key from a feature's properties; `getBand` resolves the band from that
// key. Shared by the area, hedgerow and watercourse passes so all three produce
// identically-shaped offenders.
function collectOffenders(features, getKey, getBand, offenders) {
  features.forEach((feature, idx) => {
    const props = feature?.properties ?? {}
    const habitatType = getKey(props)
    const band = getBand(habitatType)
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
}

/**
 * Scan the area, hedgerow and watercourse habitat layers and produce a single
 * error listing every habitat whose distinctiveness band falls outside the MVS
 * scope (i.e. High or Very High). Returns `null` when every habitat is in scope
 * (or when the layers are empty / have wrong geometry types — those cases are
 * handled by the GPKG geometry checks (NO_HABITAT_AREAS /
 * GPKG_HABITATS_WRONG_GEOMETRY_TYPE etc.).
 *
 * Each habitat family is keyed on its own reference vocabulary: area habitats on
 * the "<broad> - <type>" string, hedgerows on the hedge type column and
 * watercourses on the river type column. BMD-352 originally scanned the area
 * layer only, so V.High/High hedgerows and watercourses (e.g. a "Priority
 * habitat" river) slipped through; all three are now gated.
 *
 * Unknown habitat types — those not present in the reference tables — are
 * passed through; the schema check upstream is responsible for catching them.
 *
 * The High/Very-High exclusion is a whole-service scope limit, so it applies to
 * the post-intervention document too. `variant` selects whether habitat types
 * are read from the Baseline* or Proposed* columns; it defaults to baseline.
 *
 * @param {object} layers Output of readGeoPackage
 * @param {string} [variant] one of EXTRACT_VARIANT; defaults to baseline
 * @returns {{ code: string, message: string, details: object }|null}
 */
export function checkHabitatDistinctiveness(
  layers,
  variant = EXTRACT_VARIANT.BASELINE
) {
  const keys = featureKeysForVariant(variant)
  const offenders = []
  collectOffenders(
    layers?.areas ?? [],
    (props) => buildHabitatLookupKey(props, keys),
    getDistinctiveness,
    offenders
  )
  collectOffenders(
    layers?.hedgerows ?? [],
    (props) => linearLookupKey(props, keys.hedgerowType),
    getHedgerowDistinctiveness,
    offenders
  )
  collectOffenders(
    layers?.watercourses ?? [],
    (props) => linearLookupKey(props, keys.riverType),
    getWatercourseDistinctiveness,
    offenders
  )

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
