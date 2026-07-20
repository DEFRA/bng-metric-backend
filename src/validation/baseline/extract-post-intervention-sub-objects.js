import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-metric-engine'

import { PROP_KEYS, PROPOSED_PROP_KEYS, pickProp } from './properties.js'
import { stripConditionPrefix } from '../../utilities/baseline/condition.js'
import { deriveRetentionCategory } from '../../utilities/baseline/retention-category.js'

/** GeoPackage literal when advance/delay columns do not apply (Lost features). */
export const GPKG_NOT_APPLICABLE = 'N/A'

/** Default when advance/delay GPKG columns are absent. */
export const DEFAULT_ADVANCE_DELAY_YEARS = 0

/** Shared null score/multiplier placeholders on baseline and proposed sub-objects. */
export function emptyHabitatScoreFields() {
  return {
    conditionScore: null,
    distinctiveness: null,
    distinctivenessScore: null
  }
}

/**
 * @param {string} normalized
 * @returns {number | null}
 */
function parseAdvanceDelayFromString(normalized) {
  if (normalized.toUpperCase() === GPKG_NOT_APPLICABLE) {
    return null
  }
  if (normalized === MAX_YEARS_PLUS) {
    return MAX_YEARS
  }
  const num = Number(normalized)
  if (Number.isFinite(num)) {
    return num
  }
  return null
}

/**
 * Parse "Habitat created in advance/years" / "Delay in starting habitat
 * creation/years" from the GeoPackage. NE template files use the literal
 * "N/A" for Lost linear features (and some Lost area rows) where advance/delay
 * do not apply; those map to null. Missing columns default to 0.
 *
 * @param {unknown} rawValue
 * @returns {number | null}
 */
export function parseProposedAdvanceDelayYears(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return DEFAULT_ADVANCE_DELAY_YEARS
  }
  if (typeof rawValue === 'number') {
    if (Number.isFinite(rawValue)) {
      return rawValue
    }
    return null
  }
  if (typeof rawValue === 'string') {
    return parseAdvanceDelayFromString(rawValue.trim())
  }
  return null
}

/**
 * @param {object} props
 * @param {string[]} advanceDelayKeys
 */
export function buildAdvanceDelayFields(
  props,
  advanceDelayKeys = PROPOSED_PROP_KEYS
) {
  const rawAdvance = pickProp(props, advanceDelayKeys.advanceYears)
  const rawDelay = pickProp(props, advanceDelayKeys.delayYears)
  return {
    advanceYears: parseProposedAdvanceDelayYears(rawAdvance),
    delayYears: parseProposedAdvanceDelayYears(rawDelay)
  }
}

/**
 * @param {object} props
 * @returns {'Retained' | 'Created' | 'Enhanced' | null}
 */
export function retentionCategoryFromProps(props) {
  return deriveRetentionCategory(pickProp(props, PROP_KEYS.retentionCategory))
}

/**
 * @param {object} props
 * @returns {object}
 */
export function buildAreaBaselineSubObject(props) {
  return {
    type: pickProp(props, PROP_KEYS.habitatType),
    broadType: pickProp(props, PROP_KEYS.broadHabitat),
    condition: stripConditionPrefix(pickProp(props, PROP_KEYS.condition)),
    ...emptyHabitatScoreFields(),
    strategicSignificance: pickProp(props, PROP_KEYS.strategicSignificance)
  }
}

/**
 * @param {object} props
 * @returns {object}
 */
export function buildAreaProposedSubObject(props) {
  return {
    type: pickProp(props, PROPOSED_PROP_KEYS.habitatType),
    broadType: pickProp(props, PROPOSED_PROP_KEYS.broadHabitat),
    condition: stripConditionPrefix(
      pickProp(props, PROPOSED_PROP_KEYS.condition)
    ),
    ...emptyHabitatScoreFields(),
    strategicSignificance: pickProp(
      props,
      PROPOSED_PROP_KEYS.strategicSignificance
    ),
    ...buildAdvanceDelayFields(props)
  }
}

/**
 * @param {object} props
 * @param {string[]} typeKey
 * @returns {object}
 */
export function buildLinearBaselineSubObject(props, typeKey) {
  return {
    type: pickProp(props, typeKey),
    condition: stripConditionPrefix(pickProp(props, PROP_KEYS.condition)),
    ...emptyHabitatScoreFields()
  }
}

/**
 * @param {object} props
 * @param {string[]} typeKey
 * @returns {object}
 */
export function buildLinearProposedSubObject(props, typeKey) {
  return {
    type: pickProp(props, typeKey),
    condition: stripConditionPrefix(
      pickProp(props, PROPOSED_PROP_KEYS.condition)
    ),
    ...emptyHabitatScoreFields(),
    ...buildAdvanceDelayFields(props)
  }
}
