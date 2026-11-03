import {
  BaselineLookupError,
  calculateCreatedHedgerowPostIntervention,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS
} from 'bng-library/metric'
import {
  getHedgerowHabitatTypes,
  getConditionsForHedgerowType
} from './habitat-reference.js'
import { getAreaCreationReference } from './area-creation.js'

// Query the public calculator with zero timing to obtain the pinned engine's
// statutory creation values; impossible combinations throw BaselineLookupError.
function creationMetrics(name, condition) {
  try {
    const metrics = calculateCreatedHedgerowPostIntervention(
      1,
      name,
      condition,
      0,
      0,
      'Low'
    )
    const years = metrics.standardTimeToTargetCondition
    return {
      ...metrics,
      years: years === OVER_MAX_YEARS ? MAX_YEARS_PLUS : Number(years)
    }
  } catch (error) {
    if (error instanceof BaselineLookupError) {
      return null
    }
    throw error
  }
}
const shared = getAreaCreationReference()
const reference = {
  featureType: 'hedgerow',
  habitatTypes: getHedgerowHabitatTypes().map((type) => {
    const combinations = getConditionsForHedgerowType(type.name)
      .map((c) => ({ ...c, metrics: creationMetrics(type.name, c.condition) }))
      .filter((c) => c.metrics)
    return {
      ...type,
      difficulty: combinations[0]?.metrics.difficulty ?? null,
      difficultyMultiplier:
        combinations[0]?.metrics.difficultyMultiplier ?? null,
      conditions: combinations.map(({ condition, score, metrics }) => ({
        condition,
        score,
        years: metrics.years
      }))
    }
  }),
  strategicSignificance: shared.strategicSignificance,
  timeMultipliers: shared.timeMultipliers
}
export function getHedgerowCreationReference() {
  return structuredClone(reference)
}
