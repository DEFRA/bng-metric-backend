import { calculateEnhancedHedgerowPostIntervention } from 'bng-library/metric'
import {
  getConditionsForHedgerowType,
  getHedgerowHabitatTypes
} from './habitat-reference.js'
import { readHedgerowSide } from '../geopackage/post-intervention/enhancement-rules.js'
import { buildLinearEnhancementReference } from './linear-enhancement.js'

// BMD-1046: an Enhanced hedgerow's edit choices, by the hedgerow rules an
// import applies (BMD-820 AC6 to AC8), including the hedgerow type moves the
// metric's G-6 table allows (type to type time for a move to a more
// distinctive type, condition to condition otherwise).
const reference = buildLinearEnhancementReference({
  layer: 'hedgerows',
  featureType: 'hedgerow',
  types: getHedgerowHabitatTypes,
  conditions: getConditionsForHedgerowType,
  readSide: readHedgerowSide,
  calculate: (baselineType, type, baselineCondition, condition) =>
    calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      baselineType,
      type,
      baselineCondition,
      condition
    )
})

/**
 * The edit choices for a hedgerow enhancing `baseline`.
 *
 * @param {{ type?: string | null, condition?: string | null }} baseline the
 *   baseline hedgerow, as a post-intervention feature's `baseline` side holds it
 * @returns {{ featureType: string, habitatTypes: object[], strategicSignificance: object[], timeMultipliers: object }}
 *   habitatTypes is empty for a baseline the rules cannot enhance or read
 */
export function getHedgerowEnhancementReference(baseline = {}) {
  return reference.get(baseline)
}

/**
 * How many baselines the reference holds, for tests.
 *
 * @returns {number}
 */
export function _hedgerowEnhancementCacheSize() {
  return reference.cacheSize()
}
