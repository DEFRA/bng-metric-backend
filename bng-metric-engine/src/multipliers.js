import { BaselineLookupError } from './errors.js'
import {
  validateHabitat,
  validateCondition,
  validateYears,
  validateHabitatChange
} from './validate.js'
import {
  CONDITION_SCORES,
  DIFFICULTY_MULTIPLIER,
  DISTINCTIVENESS_CATEGORIES,
  DISTINCTIVENESS_SCORES,
  HABITAT_DIFFICULTY,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_ENHANCEMENT,
  TIME_TO_TARGET_MULTIPLIER
} from './reference-constants.js'
import {
  advanceMeetsTimeToTarget,
  applyDelayAdvanceAndClamp,
  normaliseReferenceYears,
  toTimeToTargetBucketKey
} from './linear-time-target-utils.js'

const NOT_POSSIBLE = 'Not Possible'
export const CREATION = 'Creation'
export const ENHANCEMENT = 'Enhancement'

/**
 * Resolve the statutory distinctiveness band label (e.g. "Low", "V.Low") and its
 * numeric score for a habitat type key used in reference tables.
 *
 * @param {string} habitat - The habitat name (e.g., "Grassland - Bracken")
 * @returns {{ distinctiveness: string, distinctivenessScore: number }}
 */
export function resolveDistinctiveness(habitat) {
  validateHabitat(habitat)

  const distinctiveness = DISTINCTIVENESS_CATEGORIES[habitat]
  if (!distinctiveness) {
    throw new Error(`Distinctiveness level not found for habitat: ${habitat}`)
  }

  const distinctivenessData = DISTINCTIVENESS_SCORES[distinctiveness]

  if (!distinctivenessData || typeof distinctivenessData.Score !== 'number') {
    throw new Error(`Distinctiveness data not found for habitat: ${habitat}`)
  }

  return {
    distinctiveness,
    distinctivenessScore: distinctivenessData.Score
  }
}

/**
 * Get the condition multiplier for a given habitat and condition
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} condition - The condition name (e.g., "Moderate")
 * @returns {number} The condition multiplier, or 0 if habitat/condition not found or "Not Possible"
 */
function getConditionMultiplier(habitat, condition) {
  validateHabitat(habitat)
  validateCondition(habitat, condition)

  const conditionScoreRow = CONDITION_SCORES[habitat][condition]

  // Throw an error if the value is "Not Possible" or not a number
  if (conditionScoreRow === NOT_POSSIBLE) {
    throw new BaselineLookupError(
      `Condition '${condition}' is not a valid condition for habitat: ${habitat}`
    )
  }

  // Return the numeric condition score value
  if (typeof conditionScoreRow === 'number') {
    return conditionScoreRow
  }
  throw new TypeError(
    `Condition score is not a number for habitat: ${habitat}, condition: ${condition}`
  )
}

function lookupCreationTimeToTarget(habitat, endCondition) {
  const timeToTargetValue = TIME_TO_TARGET_CREATION[habitat]?.[endCondition]

  if (timeToTargetValue === undefined || timeToTargetValue === null) {
    throw new Error(
      `Time to target not found for habitat: ${habitat}, endCondition: ${endCondition}`
    )
  }
  if (timeToTargetValue === NOT_POSSIBLE) {
    throw new Error(
      `Time to target '${NOT_POSSIBLE}' for habitat: ${habitat}, endCondition: ${endCondition}`
    )
  }
  return timeToTargetValue
}

function lookupEnhancementTimeToTarget(
  habitat,
  creationOrEnhancement,
  startCondition,
  endCondition
) {
  const timeToTargetValue =
    TIME_TO_TARGET_ENHANCEMENT[habitat]?.[startCondition]?.[endCondition]

  if (timeToTargetValue === undefined || timeToTargetValue === null) {
    throw new Error(
      `Time to target not found for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}, startCondition: ${startCondition}, endCondition: ${endCondition}`
    )
  }
  if (timeToTargetValue === NOT_POSSIBLE) {
    throw new Error(
      `Time to target '${NOT_POSSIBLE}' for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}, startCondition: ${startCondition}, endCondition: ${endCondition}`
    )
  }
  return timeToTargetValue
}

function lookupRawTimeToTarget(
  habitat,
  creationOrEnhancement,
  startCondition,
  endCondition
) {
  const rawValue =
    creationOrEnhancement === CREATION
      ? lookupCreationTimeToTarget(habitat, endCondition)
      : lookupEnhancementTimeToTarget(
          habitat,
          creationOrEnhancement,
          startCondition,
          endCondition
        )

  return normaliseReferenceYears(rawValue)
}

/**
 * Get the time to target value for a given habitat and creation/enhancement type
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} creationOrEnhancement - Either "Creation" or "Enhancement" (CREATION or ENHANCEMENT)
 * @param {string} [startCondition] - The starting condition (optional, only needed for Enhancement)
 * @param {string} endCondition - The target condition (required for both Creation and Enhancement)
 * @param {number} advanceYears - The number of years to advance the project
 * @param {number} delayYears - The number of years to delay the project
 * @returns {string} Time-to-target bucket key (e.g. "5", ">30")
 * @throws {Error} If time to target not found for habitat/type
 */
function getTimeToTargetValue(
  habitat,
  creationOrEnhancement,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  validateHabitat(habitat)
  validateHabitatChange(creationOrEnhancement)
  validateCondition(habitat, endCondition)
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)

  const referenceYears = lookupRawTimeToTarget(
    habitat,
    creationOrEnhancement,
    startCondition,
    endCondition
  )
  const computedYears = applyDelayAdvanceAndClamp(
    referenceYears,
    validatedAdvanceYears,
    validatedDelayYears
  )
  return toTimeToTargetBucketKey(computedYears)
}

/**
 * Get the time multiplier for a given habitat and creation/enhancement type
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} creationOrEnhancement - Either "Creation" or "Enhancement" (CREATION or ENHANCEMENT)
 * @param {string} [startCondition] - The starting condition (optional, only needed for Enhancement)
 * @param {string} endCondition - The target condition (required for both Creation and Enhancement)
 * @param {number} advanceYears - The number of years to advance the project
 * @param {number} delayYears - The number of years to delay the project
 * @returns {number} The time multiplier, or 0 if habitat/type not found
 */
function getTimeMultiplier(
  habitat,
  creationOrEnhancement,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  validateHabitat(habitat)
  validateHabitatChange(creationOrEnhancement)
  validateCondition(habitat, endCondition)
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)
  validateEnhancementStartCondition(
    habitat,
    creationOrEnhancement,
    startCondition
  )

  const timeToTargetKey = getTimeToTargetValue(
    habitat,
    creationOrEnhancement,
    startCondition,
    endCondition,
    validatedAdvanceYears,
    validatedDelayYears
  )

  const timeMultiplier = TIME_TO_TARGET_MULTIPLIER[timeToTargetKey]

  if (timeMultiplier === undefined || timeMultiplier === null) {
    throw new Error(
      `Time multiplier not found for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}, startCondition: ${startCondition}, endCondition: ${endCondition}`
    )
  } else if (timeMultiplier === NOT_POSSIBLE) {
    throw new Error(`Time multiplier for habitat '${habitat}' is not possible`)
  } else {
    return timeMultiplier
  }
}

/**
 * @param {string} habitat
 * @param {string} creationOrEnhancement
 * @param {string | undefined} startCondition
 */
function validateEnhancementStartCondition(
  habitat,
  creationOrEnhancement,
  startCondition
) {
  if (
    creationOrEnhancement === ENHANCEMENT &&
    (!startCondition || typeof startCondition !== 'string')
  ) {
    throw new Error(
      `Start condition not specified for enhancement of habitat: ${habitat}`
    )
  }
}

/**
 * @param {string} habitat
 * @param {string} creationOrEnhancement
 * @param {string | undefined} startCondition
 * @param {number} validatedAdvanceYears
 * @param {number} validatedDelayYears
 * @param {string} timeToTargetValue
 * @returns {string}
 */
function resolveDifficultyDesc(
  habitat,
  creationOrEnhancement,
  startCondition,
  validatedAdvanceYears,
  validatedDelayYears,
  timeToTargetValue
) {
  if (advanceMeetsTimeToTarget(validatedAdvanceYears, timeToTargetValue)) {
    return 'Low'
  }
  const difficultyChangeType = resolveDifficultyChangeType(
    habitat,
    creationOrEnhancement,
    startCondition,
    validatedAdvanceYears,
    validatedDelayYears
  )
  const difficultyRow = HABITAT_DIFFICULTY[habitat]
  if (!difficultyRow || typeof difficultyRow !== 'object') {
    throw new Error(`No difficulty reference data for habitat: ${habitat}`)
  }
  const difficultyDesc = difficultyRow[difficultyChangeType]
  if (!difficultyDesc) {
    throw new Error(
      `Difficulty not found for habitat: ${habitat}, creationOrEnhancement: ${difficultyChangeType}`
    )
  }
  return difficultyDesc
}

/**
 * Statutory tool: Creation projects with enough advance time to reach Poor but not
 * the full target use Enhancement difficulty bands for lookup.
 *
 * @param {string} habitat
 * @param {string} creationOrEnhancement
 * @param {string} [startCondition]
 * @param {number} validatedAdvanceYears
 * @param {number} validatedDelayYears
 * @returns {CREATION | ENHANCEMENT}
 */
function resolveDifficultyChangeType(
  habitat,
  creationOrEnhancement,
  startCondition,
  validatedAdvanceYears,
  validatedDelayYears
) {
  if (creationOrEnhancement === ENHANCEMENT) {
    return ENHANCEMENT
  }

  const poorTargetYears = getTimeToTargetValue(
    habitat,
    creationOrEnhancement,
    startCondition,
    'Poor',
    validatedAdvanceYears,
    validatedDelayYears
  )

  return advanceMeetsTimeToTarget(validatedAdvanceYears, poorTargetYears)
    ? ENHANCEMENT
    : CREATION
}

/**
 * Get the difficulty multiplier for a given habitat and creation/enhancement type
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} creationOrEnhancement - Either "Creation" or "Enhancement" (CREATION or ENHANCEMENT)
 * @param {string} [startCondition] - The starting condition (optional, only needed for Enhancement)
 * @param {string} endCondition - The target condition (required for both Creation and Enhancement)
 * @param {number} advanceYears - The number of years to advance the project
 * @param {number} delayYears - The number of years to delay the project
 * @returns {number} The difficulty multiplier, or 0 if habitat/type not found
 */
function getDifficultyMultiplier(
  habitat,
  creationOrEnhancement,
  startCondition,
  endCondition,
  advanceYears,
  delayYears
) {
  validateHabitat(habitat)
  validateHabitatChange(creationOrEnhancement)
  validateCondition(habitat, endCondition)
  const validatedAdvanceYears = validateYears(advanceYears)
  const validatedDelayYears = validateYears(delayYears)
  validateEnhancementStartCondition(
    habitat,
    creationOrEnhancement,
    startCondition
  )

  const timeToTargetValue = getTimeToTargetValue(
    habitat,
    creationOrEnhancement,
    startCondition,
    endCondition,
    validatedAdvanceYears,
    validatedDelayYears
  )

  const difficultyDesc = resolveDifficultyDesc(
    habitat,
    creationOrEnhancement,
    startCondition,
    validatedAdvanceYears,
    validatedDelayYears,
    timeToTargetValue
  )

  const difficultyMultiplier = DIFFICULTY_MULTIPLIER[difficultyDesc]

  if (difficultyMultiplier == null || difficultyMultiplier === NOT_POSSIBLE) {
    throw new Error(
      `Difficulty multiplier not found for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}`
    )
  }

  return difficultyMultiplier
}

export {
  getConditionMultiplier,
  getTimeToTargetValue,
  getTimeMultiplier,
  getDifficultyMultiplier
}
