// Adapters between the shapes the GeoPackage gives us and the shapes
// bng-library/metric expects. Shared by the baseline and post-intervention
// enrichment modules — neither flow owns these, so nothing here may depend on
// baseline- or post-intervention-specific logic.

import {
  BaselineLookupError,
  calculateAreaHabitatBaseline,
  isRecognisedEncroachmentValue,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from 'bng-library/metric'

import { stripConditionPrefix } from './condition.js'

export const LOG_ENRICH_PREFIX = 'enrichBaseline: '

/**
 * Engine entry point wrapper around stripConditionPrefix that guarantees a
 * string return value — engine calculators expect a string, not null.
 */
export function normalizeConditionForEngine(condition) {
  const stripped = stripConditionPrefix(condition)
  return typeof stripped === 'string' ? stripped : ''
}

/**
 * Engine habitat keys usually match `Baseline Habitat Type`, but some rows use
 * `{Broad} - {Habitat}` while GeoPackage stores them in separate columns.
 *
 * @param {{ type?: unknown, broadType?: unknown }} habitat
 * @returns {Generator<string>}
 */
export function* engineHabitatTypeCandidates(habitat) {
  const type = typeof habitat.type === 'string' ? habitat.type.trim() : ''
  if (type) {
    yield type

    const broad =
      typeof habitat.broadType === 'string' ? habitat.broadType.trim() : ''

    if (broad) {
      const prefix = `${broad} - `
      if (type.startsWith(prefix)) {
        // type already includes the broad-type prefix
      } else {
        yield `${broad} - ${type}`
      }
    } else {
      // no broad type — only the raw habitat type was yielded above
    }
  } else {
    // empty type — generator yields nothing
  }
}

/**
 * Try each engine habitat key in turn, returning the first that the engine
 * recognises. Throws the last lookup failure when none match.
 *
 * @param {number} sizeHa
 * @param {{ type?: unknown, broadType?: unknown }} habitat
 * @param {string} condition
 */
export function calculateAreaHabitatWithCandidates(sizeHa, habitat, condition) {
  let lastError = null
  for (const engineType of engineHabitatTypeCandidates(habitat)) {
    try {
      return calculateAreaHabitatBaseline(sizeHa, engineType, condition)
    } catch (error) {
      if (error instanceof BaselineLookupError) {
        lastError = error
      } else {
        throw error
      }
    }
  }
  if (lastError) {
    throw lastError
  } else {
    throw new BaselineLookupError('Habitat type is empty or unrecognised')
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatUnrecognisedEncroachmentValue(value) {
  if (typeof value === 'object') {
    return JSON.stringify(value)
  } else {
    return String(value) // NOSONAR S6551 — typeof guard above proves value is a primitive
  }
}

/**
 * @param {unknown} value
 * @param {Record<string, number>} lookupMap
 * @param {string} label
 * @returns {string}
 */
function coerceEncroachmentForBaseline(value, lookupMap, label) {
  if (
    typeof value === 'string' &&
    value.trim() &&
    isRecognisedEncroachmentValue(value, lookupMap)
  ) {
    return value
  }
  throw new BaselineLookupError(
    `Missing or unrecognised ${label}: ${formatUnrecognisedEncroachmentValue(value)}`
  )
}

/**
 * @param {object} feature
 * Missing values must never reach the engine, where null means multiplier 1.
 * @returns {{ watercourseEncroachment: string, riparianEncroachment: string }}
 */
export function resolvedWatercourseEncroachments(feature) {
  return {
    watercourseEncroachment: coerceEncroachmentForBaseline(
      feature.watercourseEncroachment,
      WATERCOURSE_ENCROACHMENT_MULTIPLIER,
      'watercourse encroachment'
    ),
    riparianEncroachment: coerceEncroachmentForBaseline(
      feature.riparianEncroachment,
      WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
      'riparian encroachment'
    )
  }
}
