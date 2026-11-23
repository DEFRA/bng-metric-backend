import {
  BaselineLookupError,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS
} from 'bng-library/metric'
import { getAreaCreationReference } from './area-creation.js'
import { enhancementTarget } from '../geopackage/post-intervention/enhancement-rules.js'

// BMD-1046 and BMD-1047: the choices an Enhanced hedgerow's or watercourse's
// edit form offers are the valid enhancements of its baseline, by the same
// rules an import applies (BMD-820, enhancement-rules.js). The shape is the
// layer's creation reference's, so the edit form reads both alike: each target
// condition carries its enhancement time to target from the baseline, and each
// habitat type its enhancement difficulty. A habitat type is listed only when
// it has at least one valid target condition.

function yearsOf(timeToTarget) {
  return timeToTarget === OVER_MAX_YEARS ? MAX_YEARS_PLUS : timeToTarget
}

// The metric's enhancement difficulty for a move, or null where the metric
// refuses it.
function enhancementMetrics(calculate, baseline, type, condition) {
  try {
    return calculate(baseline.habitat, type, baseline.condition, condition)
  } catch (error) {
    if (error instanceof BaselineLookupError) {
      return null
    }
    throw error
  }
}

/**
 * @typedef {object} LinearEnhancementConfig
 * @property {string} layer the post-intervention document key the rules read
 * @property {string} featureType
 * @property {() => object[]} types the layer's habitat types
 * @property {(type: string) => object[]} conditions a habitat type's conditions
 * @property {(side: object) => { habitat: string | null, condition: unknown }} readSide
 *   a side as the layer's rules read it
 * @property {(baselineType: string, type: string, baselineCondition: string, condition: string) => object} calculate
 *   the metric's enhanced calculation for one move, throwing
 *   BaselineLookupError where it refuses it
 * @property {object} [extra] further option lists the edit form offers
 */

/**
 * A layer's enhancement reference, one answer per baseline.
 *
 * @param {LinearEnhancementConfig} config
 * @returns {{ get: (baseline?: object) => object, cacheSize: () => number }}
 */
export function buildLinearEnhancementReference(config) {
  // Keyed on the baseline as the rules read it, so the keys are the finite set
  // of real habitat types and their conditions. A baseline the rules cannot
  // read is offered nothing and never cached, so the public reference route
  // cannot fill the cache with made-up baselines.
  const referenceByBaseline = new Map()

  const conditionOf = (habitat, condition) =>
    config
      .conditions(habitat)
      .find((c) => typeof condition === 'string' && c.condition === condition)
      ?.condition ?? null

  const enhancementHabitatType = (side, baseline, type) => {
    const targets = config.conditions(type.name).flatMap((c) => {
      const target = enhancementTarget(config.layer, {
        baseline: side,
        proposed: { type: type.name, condition: c.condition }
      })
      const metrics = target.valid
        ? enhancementMetrics(config.calculate, baseline, type.name, c.condition)
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

  const get = (baseline = {}) => {
    const side = {
      type: baseline.type ?? null,
      condition: baseline.condition ?? null
    }
    const { strategicSignificance, timeMultipliers } =
      getAreaCreationReference()
    const shared = {
      featureType: config.featureType,
      strategicSignificance,
      timeMultipliers,
      ...config.extra
    }
    const { habitat, condition } = config.readSide(side)
    const knownCondition = habitat ? conditionOf(habitat, condition) : null
    if (!knownCondition) {
      return structuredClone({ ...shared, habitatTypes: [] })
    }
    const key = `${habitat}|${knownCondition}`
    if (!referenceByBaseline.has(key)) {
      const read = { habitat, condition: knownCondition }
      referenceByBaseline.set(key, {
        ...shared,
        habitatTypes: config
          .types()
          .map((type) => enhancementHabitatType(side, read, type))
          .filter((type) => type.conditions.length)
      })
    }
    return structuredClone(referenceByBaseline.get(key))
  }

  return { get, cacheSize: () => referenceByBaseline.size }
}
