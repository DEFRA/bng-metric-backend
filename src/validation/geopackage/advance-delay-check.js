import { ERROR_CODES, makeError } from './errors.js'
import { parseProposedAdvanceDelayYears } from './post-intervention/extract-post-intervention-sub-objects.js'
import {
  PROP_KEYS,
  PROPOSED_PROP_KEYS,
  TREE_ADVANCE_DELAY_KEYS,
  pickProp
} from './properties.js'

const SAMPLE_CAP = 50

/**
 * Layers whose advance/delay columns feed the rules engine, with the columns
 * each one reads. The Urban Trees layer spells both columns differently from
 * the others, so it carries its own keys and its own reference column.
 */
const SCANNED_LAYERS = [
  { layer: 'areas', keys: PROPOSED_PROP_KEYS, refKeys: PROP_KEYS.parcelRef },
  {
    layer: 'hedgerows',
    keys: PROPOSED_PROP_KEYS,
    refKeys: PROP_KEYS.parcelRef
  },
  {
    layer: 'watercourses',
    keys: PROPOSED_PROP_KEYS,
    refKeys: PROP_KEYS.parcelRef
  },
  { layer: 'trees', keys: TREE_ADVANCE_DELAY_KEYS, refKeys: PROP_KEYS.treeRef }
]

/** Column names quoted back to the user, matching the NE template headings. */
function describeColumns(keys) {
  return `"${keys.advanceYears[0]}" and "${keys.delayYears[0]}"`
}

function describeFeature({ layer, refKeys }, feature, idx) {
  const properties = feature?.properties ?? {}
  const ref = pickProp(properties, refKeys)
  if (ref != null && ref !== '') {
    return `${layer} ${refKeys[0]} ${ref}`
  }
  const fid = pickProp(properties, PROP_KEYS.fid)
  if (fid != null && fid !== '') {
    return `${layer} fid ${fid}`
  }
  return `${layer} feature #${idx}`
}

function hasBothYears(properties, keys) {
  const advance = parseProposedAdvanceDelayYears(
    pickProp(properties, keys.advanceYears)
  )
  const delay = parseProposedAdvanceDelayYears(
    pickProp(properties, keys.delayYears)
  )
  // Zero means "not entered", so both being non-zero is both being used.
  return advance > 0 && delay > 0
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
 * @param {object} layers Output of readGeoPackage
 * @returns {{ code: string, message: string, details: { count: number, sample: string[] } }|null}
 */
export function checkAdvanceAndDelayNotBothSet(layers) {
  const offenders = []
  const columns = new Set()
  for (const scanned of SCANNED_LAYERS) {
    const features = layers?.[scanned.layer] ?? []
    features.forEach((feature, idx) => {
      if (hasBothYears(feature?.properties ?? {}, scanned.keys)) {
        offenders.push(describeFeature(scanned, feature, idx))
        columns.add(describeColumns(scanned.keys))
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
    `One or more features set both ${[...columns].join(' or ')}. Use one or the other: ${shown}${more}`,
    { count: offenders.length, sample }
  )
}
