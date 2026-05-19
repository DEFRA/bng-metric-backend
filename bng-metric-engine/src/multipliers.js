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
 * Get the distinctiveness score for a given habitat
 * @param {string} habitat - The habitat name (e.g., "Grassland - Bracken")
 * @returns {number} The distinctiveness score, or 0 if habitat not found
 */
function getDistinctivenessMultiplier(habitat) {
  return resolveDistinctiveness(habitat).distinctivenessScore
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

  // If the value is "Not Possible" or not a number, return 0
  if (conditionScoreRow === 'Not Possible') {
    throw new Error(
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

/**
 * Get the time to target value for a given habitat and creation/enhancement type
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} creationOrEnhancement - Either "Creation" or "Enhancement"
 * @param {string} [startCondition] - The starting condition (optional, only needed for Enhancement)
 * @param {string} endCondition - The target condition (required for both Creation and Enhancement)
 * @param {number} delayYears - The number of years to delay the project
 * @param {number} advanceYears - The number of years to advance the project
 * @returns {number} The time to target value, or 0 if habitat/type not found
 * @throws {Error} If time to target not found for habitat/type
 */

function getTimeToTargetValue(
  habitat,
  creationOrEnhancement,
  startCondition,
  endCondition,
  delayYears,
  advanceYears
) {
  validateHabitat(habitat)
  validateHabitatChange(creationOrEnhancement)
  validateCondition(habitat, endCondition)
  advanceYears = validateYears(advanceYears)
  delayYears = validateYears(delayYears)

  let timeToTargetValue
  if (creationOrEnhancement === 'Creation') {
    timeToTargetValue = TIME_TO_TARGET_CREATION[habitat]?.[endCondition]
  } else {
    timeToTargetValue =
      TIME_TO_TARGET_ENHANCEMENT[habitat]?.[startCondition]?.[endCondition]
    // Return 0 if not found or "Not Possible"
    if (timeToTargetValue === undefined || timeToTargetValue === null) {
      throw new Error(
        `Time to target not found for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}, startCondition: ${startCondition}, endCondition: ${endCondition}`
      )
    } else if (timeToTargetValue === 'Not Possible') {
      timeToTargetValue = 1
    }
  }

  // Considering "30+" as 30 years (not sure if this is correct)
  if (timeToTargetValue === '30+') {
    timeToTargetValue = 30
  }

  // Now need to factor in the delay and advance years
  timeToTargetValue = timeToTargetValue + delayYears - advanceYears

  if (timeToTargetValue < 0) {
    timeToTargetValue = 0
  } else if (timeToTargetValue > 30) {
    timeToTargetValue = '>30'
  }

  return timeToTargetValue
}

/**
 * Get the time multiplier for a given habitat and creation/enhancement type
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} creationOrEnhancement - Either "Creation" or "Enhancement"
 * @param {string} [startCondition] - The starting condition (optional, only needed for Enhancement)
 * @param {string} endCondition - The target condition (required for both Creation and Enhancement)
 * @param {number} delayYears - The number of years to delay the project
 * @param {number} advanceYears - The number of years to advance the project
 * @returns {number} The time multiplier, or 0 if habitat/type not found
 */
function getTimeMultiplier(
  habitat,
  creationOrEnhancement,
  startCondition,
  endCondition,
  delayYears,
  advanceYears
) {
  validateHabitat(habitat)
  validateHabitatChange(creationOrEnhancement)
  validateCondition(habitat, endCondition)
  advanceYears = validateYears(advanceYears)
  delayYears = validateYears(delayYears)

  // For Enhancement, startCondition is required
  if (
    creationOrEnhancement === 'Enhancement' &&
    (!startCondition || typeof startCondition !== 'string')
  ) {
    throw new Error(
      `Start condition not specified for enhancement of habitat: ${habitat}`
    )
  }

  const timeToTargetValue = getTimeToTargetValue(
    habitat,
    creationOrEnhancement,
    startCondition,
    endCondition,
    delayYears,
    advanceYears
  )

  const timeKey =
    typeof timeToTargetValue === 'number'
      ? String(timeToTargetValue)
      : timeToTargetValue
  const timeMultiplier = TIME_TO_TARGET_MULTIPLIER[timeKey]

  if (timeMultiplier === undefined || timeMultiplier === null) {
    throw new Error(
      `Time multiplier not found for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}, startCondition: ${startCondition}, endCondition: ${endCondition}`
    )
  } else if (timeMultiplier === 'Not Possible') {
    throw new Error(`Time multiplier for habitat '${habitat}' is not possible`)
  }

  return timeMultiplier
}

/**
 * Get the difficulty multiplier for a given habitat and creation/enhancement type
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} creationOrEnhancement - Either "Creation" or "Enhancement"
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
  advanceYears = validateYears(advanceYears)
  delayYears = validateYears(delayYears)

  // For Enhancement, startCondition is required
  if (
    creationOrEnhancement === 'Enhancement' &&
    (!startCondition || typeof startCondition !== 'string')
  ) {
    throw new Error(
      `Start condition not specified for enhancement of habitat: ${habitat}`
    )
  }

  let difficultyDesc

  const timeToTargetValue = getTimeToTargetValue(
    habitat,
    creationOrEnhancement,
    startCondition,
    endCondition,
    delayYears,
    advanceYears
  )
  if (advanceYears >= timeToTargetValue) {
    difficultyDesc = 'Low'
  } else {
    if (creationOrEnhancement === 'Creation') {
      const poorTargetYears = getTimeToTargetValue(
        habitat,
        creationOrEnhancement,
        startCondition,
        'Poor',
        delayYears,
        advanceYears
      )
      if (advanceYears >= poorTargetYears) {
        creationOrEnhancement = 'Enhancement'
      }
    }

    // Look up the habitat in habitatDifficulty
    difficultyDesc = HABITAT_DIFFICULTY[habitat][creationOrEnhancement]
    if (!difficultyDesc) {
      throw new Error(
        `Difficulty not found for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}`
      )
    }
  }

  const difficultyMultiplier = DIFFICULTY_MULTIPLIER[difficultyDesc]

  if (
    difficultyMultiplier === undefined ||
    difficultyMultiplier === null ||
    difficultyMultiplier === 'Not Possible'
  ) {
    throw new Error(
      `Difficulty multiplier not found for habitat: ${habitat}, creationOrEnhancement: ${creationOrEnhancement}`
    )
  }

  return difficultyMultiplier
}

export {
  getDistinctivenessMultiplier,
  getConditionMultiplier,
  getTimeToTargetValue,
  getTimeMultiplier,
  getDifficultyMultiplier
}
