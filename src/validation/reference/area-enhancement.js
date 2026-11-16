import { DIFFICULTY_MULTIPLIER, HABITAT_DIFFICULTY } from 'bng-library/metric'
import { getAreaCreationReference } from './area-creation.js'
import {
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType
} from './habitat-reference.js'
import {
  enhancementTarget,
  readAreaSide
} from '../geopackage/post-intervention/enhancement-rules.js'

// BMD-1045: the choices an Enhanced area habitat's edit form offers are the
// valid enhancements of its baseline, by the same rules an import applies
// (BMD-820, enhancement-rules.js). The shape is /reference/area-creation's, so
// the edit form reads both alike: each target condition carries the
// enhancement time to target from that baseline, and each habitat type its
// enhancement difficulty. A broad habitat or habitat type is listed only when
// it has at least one valid target condition.

// Keyed on the baseline as the rules read it, so the keys are the finite set
// of real area habitats and their conditions. A baseline the rules cannot
// read is offered nothing and never cached, so the public reference route
// cannot fill the cache with made-up baselines.
const referenceByBaseline = new Map()

function referenceKey(table, broad, name) {
  const fullKey = `${broad} - ${name}`
  return Object.hasOwn(table, fullKey) ? fullKey : name
}

function conditionsFor(broad, name) {
  const fullKey = `${broad} - ${name}`
  const conditions = getConditionsForHabitatType(fullKey)
  return conditions.length ? conditions : getConditionsForHabitatType(name)
}

function validTargets(baseline, broad, type) {
  return conditionsFor(broad, type.name).flatMap((c) => {
    const target = enhancementTarget('habitats', {
      baseline,
      proposed: { broadType: broad, type: type.name, condition: c.condition }
    })
    return target.valid ? [{ ...c, years: target.timeToTarget }] : []
  })
}

function enhancementHabitatTypes(baseline) {
  return Object.entries(getAreaHabitatTypesByBroad())
    .filter(([broad]) => broad !== 'Individual trees')
    .flatMap(([broad, types]) =>
      types
        .filter((type) => !type.name.includes('(IGGI)'))
        .map((type) => {
          const difficulty =
            HABITAT_DIFFICULTY[
              referenceKey(HABITAT_DIFFICULTY, broad, type.name)
            ]?.Enhancement ?? null
          return {
            ...type,
            broad,
            difficulty,
            difficultyMultiplier: DIFFICULTY_MULTIPLIER[difficulty] ?? null,
            conditions: validTargets(baseline, broad, type)
          }
        })
        .filter((type) => type.conditions.length)
    )
}

/**
 * The edit choices for an area habitat enhancing `baseline`.
 *
 * @param {{ broadType?: string | null, type?: string | null, condition?: string | null }} baseline
 *   the baseline habitat, as a post-intervention feature's `baseline` side
 *   holds it
 * @returns {{ habitatTypes: object[], strategicSignificance: object[], timeMultipliers: object }}
 *   habitatTypes is empty for a baseline the rules cannot enhance
 */
export function getAreaEnhancementReference(baseline = {}) {
  const side = {
    broadType: baseline.broadType ?? null,
    type: baseline.type ?? null,
    condition: baseline.condition ?? null
  }
  const { strategicSignificance, timeMultipliers } = getAreaCreationReference()
  const { habitat, condition } = readAreaSide(side)
  if (!habitat || !isConditionOf(habitat, condition)) {
    return { habitatTypes: [], strategicSignificance, timeMultipliers }
  }
  const key = `${habitat}|${condition}`
  if (!referenceByBaseline.has(key)) {
    referenceByBaseline.set(key, {
      habitatTypes: enhancementHabitatTypes(side),
      strategicSignificance,
      timeMultipliers
    })
  }
  return structuredClone(referenceByBaseline.get(key))
}

function isConditionOf(habitat, condition) {
  return (
    typeof condition === 'string' &&
    getConditionsForHabitatType(habitat).some((c) => c.condition === condition)
  )
}

/**
 * How many baselines the reference holds, for tests.
 *
 * @returns {number}
 */
export function _areaEnhancementCacheSize() {
  return referenceByBaseline.size
}
