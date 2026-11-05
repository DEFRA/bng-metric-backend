import {
  BaselineLookupError,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS
} from 'bng-library/metric'
import { getAreaCreationReference } from './area-creation.js'

// The public engine excludes impossible creation combinations and supplies the
// same difficulty and time values used when the edited feature is saved.
export function buildLinearCreationReference({
  featureType,
  types,
  conditions,
  calculate,
  extra = {}
}) {
  const shared = getAreaCreationReference()
  return {
    featureType,
    habitatTypes: types.map((type) => {
      const combinations = conditions(type.name).flatMap((choice) => {
        try {
          const metrics = calculate(type.name, choice.condition)
          return [{ ...choice, metrics }]
        } catch (error) {
          if (error instanceof BaselineLookupError) {
            return []
          }
          throw error
        }
      })
      return {
        ...type,
        difficulty: combinations[0]?.metrics.difficulty ?? null,
        difficultyMultiplier:
          combinations[0]?.metrics.difficultyMultiplier ?? null,
        conditions: combinations.map(({ condition, score, metrics }) => ({
          condition,
          score,
          years:
            metrics.standardTimeToTargetCondition === OVER_MAX_YEARS
              ? MAX_YEARS_PLUS
              : Number(metrics.standardTimeToTargetCondition)
        }))
      }
    }),
    strategicSignificance: shared.strategicSignificance,
    timeMultipliers: shared.timeMultipliers,
    ...extra
  }
}
