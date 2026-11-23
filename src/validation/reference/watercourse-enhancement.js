import { calculateEnhancedWatercoursePostIntervention } from 'bng-library/metric'
import {
  getConditionsForWatercourseType,
  getRiparianEncroachmentOptions,
  getWatercourseEncroachmentOptions,
  getWatercourseHabitatTypes
} from './habitat-reference.js'
import { readWatercourseSide } from '../geopackage/post-intervention/enhancement-rules.js'
import { buildLinearEnhancementReference } from './linear-enhancement.js'

// BMD-1047: an Enhanced watercourse's edit choices, by the watercourse rules an
// import applies (BMD-820 AC9 and AC10): a Medium distinctiveness baseline
// keeps its habitat type and moves to a better condition, and a Low one
// (Culvert) moves to any Medium distinctiveness watercourse. Its encroachment
// lists are not restricted by the rules, so they are the creation reference's.
const reference = buildLinearEnhancementReference({
  layer: 'watercourses',
  featureType: 'watercourse',
  types: getWatercourseHabitatTypes,
  conditions: getConditionsForWatercourseType,
  readSide: readWatercourseSide,
  calculate: (baselineType, type, baselineCondition, condition) =>
    calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      baselineType,
      type,
      baselineCondition,
      condition,
      {
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment'
      }
    ),
  extra: {
    watercourseEncroachment: getWatercourseEncroachmentOptions(),
    riparianEncroachment: getRiparianEncroachmentOptions()
  }
})

/**
 * The edit choices for a watercourse enhancing `baseline`.
 *
 * @param {{ type?: string | null, condition?: string | null }} baseline the
 *   baseline watercourse, as a post-intervention feature's `baseline` side
 *   holds it
 * @returns {{ featureType: string, habitatTypes: object[], strategicSignificance: object[], timeMultipliers: object, watercourseEncroachment: string[], riparianEncroachment: string[] }}
 *   habitatTypes is empty for a baseline the rules cannot enhance or read
 */
export function getWatercourseEnhancementReference(baseline = {}) {
  return reference.get(baseline)
}

/**
 * How many baselines the reference holds, for tests.
 *
 * @returns {number}
 */
export function _watercourseEnhancementCacheSize() {
  return reference.cacheSize()
}
