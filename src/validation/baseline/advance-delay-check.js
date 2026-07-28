import { ERROR_CODES, makeError } from './errors.js'
import { parseProposedAdvanceDelayYears } from './extract-post-intervention-sub-objects.js'
import { PROP_KEYS, PROPOSED_PROP_KEYS, pickProp } from './properties.js'

const SAMPLE_CAP = 50
const NO_YEARS = 0

/** Column names quoted back to the user, matching the NE template headings. */
const ADVANCE_COLUMN = PROPOSED_PROP_KEYS.advanceYears[0]
const DELAY_COLUMN = PROPOSED_PROP_KEYS.delayYears[0]

/**
 * Layers whose advance/delay columns feed the rules engine. The Urban Trees
 * layer spells both columns differently and is not read by
 * buildAdvanceDelayFields, so nothing it carries can reach the engine; it is
 * left out here rather than rejected for a value we ignore.
 */
const SCANNED_LAYERS = ['areas', 'hedgerows', 'watercourses']

function describeFeature(layer, feature, idx) {
  const ref = pickProp(feature?.properties ?? {}, PROP_KEYS.parcelRef)
  if (ref != null && ref !== '') {
    return `${layer} Parcel Ref ${ref}`
  }
  const fid = pickProp(feature?.properties ?? {}, PROP_KEYS.fid)
  if (fid != null && fid !== '') {
    return `${layer} fid ${fid}`
  }
  return `${layer} feature #${idx}`
}

function hasBothYears(properties) {
  const advance = parseProposedAdvanceDelayYears(
    pickProp(properties, PROPOSED_PROP_KEYS.advanceYears)
  )
  const delay = parseProposedAdvanceDelayYears(
    pickProp(properties, PROPOSED_PROP_KEYS.delayYears)
  )
  return advance > NO_YEARS && delay > NO_YEARS
}

/**
 * Reject features carrying both advance and delay years.
 *
 * The statutory metric raises an error for this: "Both advance and delayed
 * creation cannot be used on the same habitat. Select either the advance
 * creation or the delayed creation but not both." Staggered creation is
 * expressed as two rows, so there is no legitimate input to preserve.
 *
 * Left unrejected the pair does not merely round oddly — the time multiplier
 * nets the two while the difficulty multiplier honours only the advance, so a
 * parcel whose timing has not changed can score several times the units.
 *
 * @param {object} layers Output of readBaselineGeoPackage
 * @returns {{ code: string, message: string, details: { count: number, sample: string[] } }|null}
 */
export function checkAdvanceAndDelayNotBothSet(layers) {
  const offenders = []
  for (const layer of SCANNED_LAYERS) {
    const features = layers?.[layer] ?? []
    features.forEach((feature, idx) => {
      if (hasBothYears(feature?.properties ?? {})) {
        offenders.push(describeFeature(layer, feature, idx))
      }
    })
  }

  if (offenders.length === 0) {
    return null
  }

  const sample = offenders.slice(0, SAMPLE_CAP)
  const shown = sample.join(', ')
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''

  return makeError(
    ERROR_CODES.ADVANCE_AND_DELAY_BOTH_SET,
    `One or more features set both "${ADVANCE_COLUMN}" and "${DELAY_COLUMN}". Use one or the other: ${shown}${more}`,
    { count: offenders.length, sample }
  )
}
