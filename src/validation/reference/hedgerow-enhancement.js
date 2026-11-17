import {
  BaselineLookupError,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS,
  calculateEnhancedHedgerowPostIntervention
} from 'bng-library/metric'
import { getAreaCreationReference } from './area-creation.js'
import {
  getConditionsForHedgerowType,
  getHedgerowHabitatTypes
} from './habitat-reference.js'
import {
  enhancementTarget,
  readHedgerowSide
} from '../geopackage/post-intervention/enhancement-rules.js'

// BMD-1046: the choices an Enhanced hedgerow's edit form offers are the valid
// enhancements of its baseline, by the same hedgerow rules an import applies
// (BMD-820 AC6 to AC8, enhancement-rules.js), including the hedgerow type moves
// the metric's G-6 table allows. The shape is /reference/hedgerow-creation's,
// so the edit form reads both alike: each target condition carries its
// enhancement time to target from the baseline (type to type for a move to a
// more distinctive type, condition to condition otherwise), and each habitat
// type its enhancement difficulty. A habitat type is listed only when it has
// at least one valid target condition.

// Keyed on the baseline as the rules read it, so the keys are the finite set
// of real hedgerow types and their conditions. A baseline the rules cannot
// read is offered nothing and never cached, so the public reference route
// cannot fill the cache with made-up baselines.
const referenceByBaseline = new Map()

// The metric's enhancement difficulty for a move, or null where the metric
// refuses it.
function enhancementMetrics(baseline, type, condition) {
  try {
    return calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      baseline.habitat,
      type,
      baseline.condition,
      condition
    )
  } catch (error) {
    if (error instanceof BaselineLookupError) {
      return null
    }
    throw error
  }
}

function yearsOf(timeToTarget) {
  return timeToTarget === OVER_MAX_YEARS ? MAX_YEARS_PLUS : timeToTarget
}

function enhancementHabitatType(side, baseline, type) {
  const targets = getConditionsForHedgerowType(type.name).flatMap((c) => {
    const target = enhancementTarget('hedgerows', {
      baseline: side,
      proposed: { type: type.name, condition: c.condition }
    })
    const metrics = target.valid
      ? enhancementMetrics(baseline, type.name, c.condition)
      : null
    return metrics
      ? [{ choice: { ...c, years: yearsOf(target.timeToTarget) }, metrics }]
      : []
  })
  return {
    ...type,
    difficulty: targets[0]?.metrics.difficulty ?? null,
    difficultyMultiplier: targets[0]?.metrics.difficultyMultiplier ?? null,
    conditions: targets.map(({ choice }) => choice)
  }
}

/**
 * The edit choices for a hedgerow enhancing `baseline`.
 *
 * @param {{ type?: string | null, condition?: string | null }} baseline the
 *   baseline hedgerow, as a post-intervention feature's `baseline` side holds it
 * @returns {{ featureType: string, habitatTypes: object[], strategicSignificance: object[], timeMultipliers: object }}
 *   habitatTypes is empty for a baseline the rules cannot enhance or read
 */
export function getHedgerowEnhancementReference(baseline = {}) {
  const side = {
    type: baseline.type ?? null,
    condition: baseline.condition ?? null
  }
  const { strategicSignificance, timeMultipliers } = getAreaCreationReference()
  const shared = {
    featureType: 'hedgerow',
    strategicSignificance,
    timeMultipliers
  }
  const { habitat, condition } = readHedgerowSide(side)
  const knownCondition = habitat ? conditionOf(habitat, condition) : null
  if (!knownCondition) {
    return { ...shared, habitatTypes: [] }
  }
  const key = `${habitat}|${knownCondition}`
  if (!referenceByBaseline.has(key)) {
    const read = { habitat, condition: knownCondition }
    referenceByBaseline.set(key, {
      ...shared,
      habitatTypes: getHedgerowHabitatTypes()
        .map((type) => enhancementHabitatType(side, read, type))
        .filter((type) => type.conditions.length)
    })
  }
  return structuredClone(referenceByBaseline.get(key))
}

// The hedgerow type's reference condition the baseline names, or null.
function conditionOf(habitat, condition) {
  return (
    getConditionsForHedgerowType(habitat).find(
      (c) => typeof condition === 'string' && c.condition === condition
    )?.condition ?? null
  )
}

/**
 * How many baselines the reference holds, for tests.
 *
 * @returns {number}
 */
export function _hedgerowEnhancementCacheSize() {
  return referenceByBaseline.size
}
