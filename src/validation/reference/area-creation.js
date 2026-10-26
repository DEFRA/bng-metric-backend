import {
  DIFFICULTY_MULTIPLIER,
  HABITAT_DIFFICULTY,
  STRATEGIC_SIGNIFICANCE_MULTIPLIER,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_MULTIPLIER
} from 'bng-library/metric'
import {
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType
} from './habitat-reference.js'

export function getAreaCreationReference() {
  const habitatTypes = Object.entries(getAreaHabitatTypesByBroad())
    .filter(([broad]) => broad !== 'Individual trees')
    .flatMap(([broad, types]) =>
      types
        .filter((type) => !type.name.includes('(IGGI)'))
        .map((type) => {
          const fullKey = `${broad} - ${type.name}`
          const key = Object.hasOwn(TIME_TO_TARGET_CREATION, fullKey)
            ? fullKey
            : type.name
          const difficulty = HABITAT_DIFFICULTY[key]?.Creation ?? null
          const conditions = getConditionsForHabitatType(key)
            .filter((c) => {
              const years = TIME_TO_TARGET_CREATION[key]?.[c.condition]
              return typeof years === 'number' || years === '30+'
            })
            .map((c) => ({
              ...c,
              years: TIME_TO_TARGET_CREATION[key][c.condition]
            }))
          return {
            ...type,
            broad,
            difficulty,
            difficultyMultiplier: DIFFICULTY_MULTIPLIER[difficulty] ?? null,
            conditions
          }
        })
    )
  return {
    habitatTypes,
    strategicSignificance: Object.values(STRATEGIC_SIGNIFICANCE_MULTIPLIER).map(
      (s) => ({ value: s.Category, score: s.Multiplier })
    ),
    timeMultipliers: {
      ...TIME_TO_TARGET_MULTIPLIER,
      '30+': TIME_TO_TARGET_MULTIPLIER['>30']
    }
  }
}
