import {
  DIFFICULTY_MULTIPLIER,
  HABITAT_DIFFICULTY,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS,
  STRATEGIC_SIGNIFICANCE_MULTIPLIER,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_MULTIPLIER
} from 'bng-library/metric'
import {
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType
} from './habitat-reference.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from '../geopackage/tree-constants.js'

const isTrees = (broad) => broad === INDIVIDUAL_TREES_BROAD_HABITAT

/**
 * The creation choices for the broad habitats `includeBroad` keeps: each
 * habitat type with the target conditions it can be created to, its creation
 * difficulty, and the multipliers the edit page prices a creation with.
 *
 * @param {(broad: string) => boolean} includeBroad
 */
function buildCreationReference(includeBroad) {
  const habitatTypes = Object.entries(getAreaHabitatTypesByBroad())
    .filter(([broad]) => includeBroad(broad))
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
              return typeof years === 'number' || years === MAX_YEARS_PLUS
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
      [MAX_YEARS_PLUS]: TIME_TO_TARGET_MULTIPLIER[OVER_MAX_YEARS]
    }
  }
}

// The pinned library reference data is static for this process. Keep the
// cached snapshots private so callers cannot mutate another request's choices.
// Individual trees have their own: a tree is created as an Urban tree or a
// Rural tree and can never become another area habitat (BMD-1172).
const areaCreationReference = structuredClone(
  buildCreationReference((broad) => !isTrees(broad))
)
const treeCreationReference = structuredClone(buildCreationReference(isTrees))

export function getAreaCreationReference() {
  return structuredClone(areaCreationReference)
}

export function getTreeCreationReference() {
  return structuredClone(treeCreationReference)
}
