import { HABITAT_REF } from 'bng-library/bng-service'

import { ERROR_CODES, makeError } from './errors.js'
import { irreplaceableFromProps } from './irreplaceable.js'
import { PROP_KEYS, pickProp } from './properties.js'

const SAMPLE_CAP = 50

/** The layer the check reads: individual trees. */
const TREE_LAYER = 'trees'

function describe(feature, idx, table) {
  const properties = feature?.properties ?? {}
  const ref = pickProp(properties, PROP_KEYS.treeRef)
  const fid = pickProp(properties, PROP_KEYS.fid)
  return {
    layer: TREE_LAYER,
    ...(table && { table }),
    feature_ref: ref == null || ref === '' ? null : String(ref),
    fid: fid == null || fid === '' ? null : fid,
    idx
  }
}

function labelOf(sample) {
  const name = sample.table ?? TREE_LAYER
  if (sample.feature_ref != null) {
    return `${name} ${HABITAT_REF} ${sample.feature_ref}`
  }
  if (sample.fid != null) {
    return `${name} fid ${sample.fid}`
  }
  return `${name} feature #${sample.idx}`
}

/**
 * Refuse individual trees marked irreplaceable (Irreplaceable Habitat "Yes"):
 * the service does not accept irreplaceable trees, such as ancient and
 * veteran trees, which the Metric guide records as irreplaceable habitat.
 * Run on each stage's tables, so a tree marked at either stage refuses the
 * file. A blank Irreplaceable Habitat is "No" (irreplaceable.js), and a legacy
 * file, which has no such column, is never refused by it.
 *
 * @param {object} layers Output of readGeoPackage
 * @returns {{ code: string, message: string, details: { count: number, sample: object[] } }|null}
 */
export function checkIrreplaceableTrees(layers) {
  const table = layers?.layerTables?.[TREE_LAYER]
  const offenders = []
  const features = layers?.[TREE_LAYER] ?? []
  features.forEach((feature, idx) => {
    if (irreplaceableFromProps(feature?.properties) === true) {
      offenders.push(describe(feature, idx, table))
    }
  })

  if (offenders.length === 0) {
    return null
  }

  const sample = offenders.slice(0, SAMPLE_CAP)
  const shown = sample.map(labelOf).join(', ')
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''

  return makeError(
    ERROR_CODES.IRREPLACEABLE_TREE,
    `One or more trees are marked as irreplaceable habitat. The service does not accept irreplaceable trees: ${shown}${more}`,
    { count: offenders.length, sample }
  )
}
