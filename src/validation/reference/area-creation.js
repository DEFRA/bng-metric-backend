import {
  DIFFICULTY_MULTIPLIER,
  HABITAT_DIFFICULTY,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS,
  STRATEGIC_SIGNIFICANCE_MULTIPLIER,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_ENHANCEMENT,
  TIME_TO_TARGET_MULTIPLIER
} from 'bng-library/metric'
import {
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType
} from './habitat-reference.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from '../geopackage/tree-constants.js'

const isTrees = (broad) => broad === INDIVIDUAL_TREES_BROAD_HABITAT

/** A time to target the Metric gives: a number of years, or 30+. */
const isPossibleYears = (years) =>
  typeof years === 'number' || years === MAX_YEARS_PLUS

/** The choices and multipliers every creation and enhancement edit shares. */
function sharedEditReference() {
  return {
    strategicSignificance: Object.values(STRATEGIC_SIGNIFICANCE_MULTIPLIER).map(
      (s) => ({ value: s.Category, score: s.Multiplier })
    ),
    timeMultipliers: {
      ...TIME_TO_TARGET_MULTIPLIER,
      [MAX_YEARS_PLUS]: TIME_TO_TARGET_MULTIPLIER[OVER_MAX_YEARS]
    }
  }
}

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
            .filter((c) =>
              isPossibleYears(TIME_TO_TARGET_CREATION[key]?.[c.condition])
            )
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
  return { habitatTypes, ...sharedEditReference() }
}

/**
 * The target conditions a tree in each baseline condition can be enhanced to:
 * the better ones the Metric gives a time to target for, each with its years.
 *
 * @param {string} key the Metric's key for the tree, "Individual trees - …"
 * @returns {Record<string, Array<{ condition: string, score: number, years: number | string }>>}
 */
function enhancementsByBaselineCondition(key) {
  const conditions = getConditionsForHabitatType(key)
  return Object.fromEntries(
    conditions.map((from) => [
      from.condition,
      conditions
        .filter(
          (to) =>
            to.score > from.score &&
            isPossibleYears(
              TIME_TO_TARGET_ENHANCEMENT[key]?.[from.condition]?.[to.condition]
            )
        )
        .map((to) => ({
          ...to,
          years: TIME_TO_TARGET_ENHANCEMENT[key][from.condition][to.condition]
        }))
    ])
  )
}

/**
 * The enhancement choices for an Enhanced individual tree. Its size, type and
 * setting are its baseline tree's, so only its condition is enhanced: each
 * habitat type gives, by baseline condition, the target conditions that are
 * a valid enhancement (enhancement-rules.js, checkTreeEnhancement), with the
 * enhancement difficulty and times to target the Metric prices them with.
 */
function buildTreeEnhancementReference() {
  const broad = INDIVIDUAL_TREES_BROAD_HABITAT
  const habitatTypes = (getAreaHabitatTypesByBroad()[broad] ?? []).map(
    (type) => {
      const key = `${broad} - ${type.name}`
      const difficulty = HABITAT_DIFFICULTY[key]?.Enhancement ?? null
      return {
        ...type,
        broad,
        difficulty,
        difficultyMultiplier: DIFFICULTY_MULTIPLIER[difficulty] ?? null,
        enhancements: enhancementsByBaselineCondition(key)
      }
    }
  )
  return { habitatTypes, ...sharedEditReference() }
}

// The pinned library reference data is static for this process. Keep the
// cached snapshots private so callers cannot mutate another request's choices.
// Individual trees have their own: a tree is created as an Urban tree or a
// Rural tree and can never become another area habitat.
const areaCreationReference = structuredClone(
  buildCreationReference((broad) => !isTrees(broad))
)
const treeCreationReference = structuredClone(buildCreationReference(isTrees))
const treeEnhancementReference = structuredClone(
  buildTreeEnhancementReference()
)

export function getAreaCreationReference() {
  return structuredClone(areaCreationReference)
}

export function getTreeCreationReference() {
  return structuredClone(treeCreationReference)
}

export function getTreeEnhancementReference() {
  return structuredClone(treeEnhancementReference)
}
