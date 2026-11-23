// Orange flags (BMD-822): the advisory warnings the statutory metric shows
// against a habitat. They never refuse a file and never change a calculated
// value — they ask the user to check evidence. Only the MVP flags are derived
// here (on-site habitats, no High / Very High distinctiveness rules); see the
// "Orange Flags: Analysis (MVP)" Confluence page for the metric cells each one
// mirrors.
//
// Both flows use these rules, so they take plain inputs rather than a stored
// feature: each flow's enrichment reads its own document shape and passes the
// fields below. Nothing here depends on either flow's modules.
//
// Flags are stored as codes. The words the user sees are owned by the content
// team and chosen by the frontend.

import {
  MAX_YEARS,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS,
  TIME_TO_TARGET_CREATION
} from 'bng-library/metric'

import { engineHabitatTypeCandidates } from './engine-helpers.js'
import { stripConditionPrefix } from './condition.js'

export const ORANGE_FLAG = Object.freeze({
  /** Head start: target condition already reached. */
  TARGET_CONDITION_REACHED: 'FLAG1',
  /** Head start: a created area habitat has already passed Poor condition. */
  POOR_THRESHOLD_PASSED: 'FLAG2',
  /** Head start: a created area habitat is in place, short of Poor condition. */
  CREATION_IN_PLACE: 'FLAG3',
  /** Head start: any other created or enhanced habitat started in advance. */
  STARTED_IN_ADVANCE: 'FLAG4',
  /** Delayed start to creation or enhancement. */
  DELAYED_START: 'FLAG5',
  /** Difficulty overridden to Low; always raised with FLAG1. */
  LOW_DIFFICULTY: 'FLAG6',
  /** A "Fairly Good" or "Fairly Poor" condition (areas and ditches). */
  FAIRLY_CONDITION: 'FLAG7',
  /** An enhanced area habitat changes broad habitat. */
  BROAD_HABITAT_CHANGE: 'FLAG8',
  /** Time to target condition of more than 30 years. */
  OVER_THIRTY_YEARS: 'FLAG9',
  /** A watercourse footprint recorded in the area data. */
  WATERCOURSE_FOOTPRINT: 'FLAG10'
})

/** Every flag code, in the order flags are stored. */
export const ORANGE_FLAG_CODES = Object.freeze(Object.values(ORANGE_FLAG))

export const UNIT_KIND = Object.freeze({
  AREA: 'area',
  HEDGEROW: 'hedgerow',
  WATERCOURSE: 'watercourse'
})

/**
 * The unit kind of each feature layer, keyed as both documents key them.
 * Trees and vertical habitats are area habitats: the metric lists them on its
 * area tabs and they are priced on the area path.
 */
export const ORANGE_FLAG_UNIT_KIND_BY_LAYER = Object.freeze({
  habitats: UNIT_KIND.AREA,
  trees: UNIT_KIND.AREA,
  verticalHabitats: UNIT_KIND.AREA,
  hedgerows: UNIT_KIND.HEDGEROW,
  watercourses: UNIT_KIND.WATERCOURSE
})

/**
 * Sets `orangeFlags` on every feature of a document's layers.
 *
 * @param {object | undefined} document
 * @param {(feature: object, layerKey: string) => string[]} deriveFlags
 */
export function applyOrangeFlagsToDocument(document, deriveFlags) {
  for (const layerKey of Object.keys(ORANGE_FLAG_UNIT_KIND_BY_LAYER)) {
    const features = document?.[layerKey]
    if (Array.isArray(features)) {
      for (const feature of features) {
        feature.orangeFlags = deriveFlags(feature, layerKey)
      }
    }
  }
}

const CREATED = 'Created'
const ENHANCED = 'Enhanced'

const FAIRLY_CONDITIONS = new Set(['Fairly Good', 'Fairly Poor'])
const DITCHES = 'Ditches'
const WATERCOURSE_FOOTPRINT = 'Watercourse footprint'

// The metric writes a time beyond 30 years as text: "30+" in the reference
// tables, and the engine's ">30" bucket for a standard time to target.
const OVER_MAX_YEAR_VALUES = new Set([MAX_YEARS_PLUS, OVER_MAX_YEARS])

/**
 * Years as the metric compares them: a blank counts as 0.
 *
 * @param {unknown} years
 * @returns {number}
 */
function yearsOrZero(years) {
  return typeof years === 'number' && Number.isFinite(years) ? years : 0
}

/**
 * Whether `years` of head start reach a reference time, compared as the
 * metric's Excel formulas compare them: text ranks above every number.
 *
 * - A numeric reference (`10`, or the text `"10"`) is reached when
 *   `years >= reference`.
 * - "30+" / ">30" is reached by the maximum advance of 30 years. An imported
 *   advance of "30+" is stored as 30, so 30 is the only value that can stand
 *   for it, and a "30+" advance meets a "30+" standard.
 * - "Not Possible", or anything else unreadable, is never reached.
 *
 * @param {number} years
 * @param {unknown} reference
 * @returns {boolean}
 */
export function yearsReach(years, reference) {
  if (OVER_MAX_YEAR_VALUES.has(reference)) {
    return years >= MAX_YEARS
  }
  const referenceYears = numericYears(reference)
  return referenceYears !== null && years >= referenceYears
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numericYears(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The years a created area habitat takes to reach Poor condition (metric tab
 * A-2, hidden column AE), as the reference table holds it: a number, "30+" or
 * "Not Possible". Null when the habitat type is not recognised.
 *
 * @param {{ type?: unknown, broadType?: unknown }} habitat
 * @returns {number | string | null}
 */
export function timeToPoorCondition(habitat) {
  for (const candidate of engineHabitatTypeCandidates(habitat)) {
    const times = TIME_TO_TARGET_CREATION[candidate]
    if (times) {
      return times.Poor ?? null
    }
  }
  return null
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isFairlyCondition(condition) {
  return FAIRLY_CONDITIONS.has(trimmed(stripConditionPrefix(condition)))
}

function isWatercourseFootprint({ type, broadType }) {
  const habitatType = trimmed(type)
  return (
    habitatType === WATERCOURSE_FOOTPRINT ||
    (trimmed(broadType) === WATERCOURSE_FOOTPRINT &&
      habitatType === `${WATERCOURSE_FOOTPRINT} - ${WATERCOURSE_FOOTPRINT}`)
  )
}

/** AC7: areas and ditches only; other watercourses' "Fairly" bands are scored. */
function raisesFairlyFlag({ unitKind, type, condition }) {
  const appliesToUnit =
    unitKind === UNIT_KIND.AREA ||
    (unitKind === UNIT_KIND.WATERCOURSE && trimmed(type) === DITCHES)
  return appliesToUnit && isFairlyCondition(condition)
}

/** AC10 */
function raisesFootprintFlag(habitat) {
  return habitat.unitKind === UNIT_KIND.AREA && isWatercourseFootprint(habitat)
}

/**
 * The flags a baseline habitat raises: FLAG7 and FLAG10.
 *
 * @param {{
 *   unitKind: 'area' | 'hedgerow' | 'watercourse',
 *   type?: unknown,
 *   broadType?: unknown,
 *   condition?: unknown
 * }} habitat the baseline habitat's own fields
 * @returns {string[]} flag codes, in code order; empty when none apply
 */
export function deriveBaselineOrangeFlags(habitat) {
  const flags = new Set()
  if (raisesFairlyFlag(habitat)) {
    flags.add(ORANGE_FLAG.FAIRLY_CONDITION)
  }
  if (raisesFootprintFlag(habitat)) {
    flags.add(ORANGE_FLAG.WATERCOURSE_FOOTPRINT)
  }
  return inCodeOrder(flags)
}

/**
 * The single head-start / delay flag (FLAG1-FLAG5) a created or enhanced
 * habitat raises, or null. The metric picks one by asking its questions in
 * order; each clause here also rules out the others (as the ACs are written),
 * so at most one can match whatever order they are checked in.
 *
 * @param {object} timing
 * @returns {string | null}
 */
function headStartOrDelayFlag({
  isCreatedArea,
  distinctivenessScore,
  advance,
  delay,
  standard,
  habitat
}) {
  // The metric raises none of FLAG1-FLAG6 for a created Very Low habitat.
  if (isCreatedArea && distinctivenessScore === 0) {
    return null
  }
  const reachesStandard = yearsReach(advance, standard)
  if (delay === 0 && reachesStandard) {
    return ORANGE_FLAG.TARGET_CONDITION_REACHED
  }
  if (advance > 0 && !reachesStandard) {
    return startedInAdvanceFlag(
      isCreatedArea,
      distinctivenessScore,
      advance,
      habitat
    )
  }
  if (advance === 0 && delay > 0) {
    return ORANGE_FLAG.DELAYED_START
  }
  return null
}

/**
 * AC2-AC4: started in advance but short of the standard time to target.
 *
 * @returns {string | null}
 */
function startedInAdvanceFlag(
  isCreatedArea,
  distinctivenessScore,
  advance,
  habitat
) {
  if (!isCreatedArea) {
    return ORANGE_FLAG.STARTED_IN_ADVANCE
  }
  if (typeof distinctivenessScore !== 'number' || distinctivenessScore <= 0) {
    return null
  }
  return yearsReach(advance, timeToPoorCondition(habitat))
    ? ORANGE_FLAG.POOR_THRESHOLD_PASSED
    : ORANGE_FLAG.CREATION_IN_PLACE
}

/**
 * AC9: the standard time is "30+", or a delay takes the final time past 30.
 *
 * @param {unknown} standard
 * @param {number} delay
 * @returns {boolean}
 */
function exceedsThirtyYears(standard, delay) {
  if (OVER_MAX_YEAR_VALUES.has(standard)) {
    return true
  }
  const standardYears = numericYears(standard)
  return standardYears !== null && standardYears + delay > MAX_YEARS
}

function hasStandardTime(standard) {
  return OVER_MAX_YEAR_VALUES.has(standard) || numericYears(standard) !== null
}

/** AC8 */
function raisesBroadHabitatFlag({
  unitKind,
  category,
  broadType,
  baselineBroadType
}) {
  const proposedBroad = trimmed(broadType)
  const parentBroad = trimmed(baselineBroadType)
  return (
    category === ENHANCED &&
    unitKind === UNIT_KIND.AREA &&
    proposedBroad !== '' &&
    parentBroad !== '' &&
    proposedBroad !== parentBroad
  )
}

/**
 * Adds the flags that rest on the engine's standard time to target: FLAG1-6
 * and FLAG9. None are raised when the habitat could not be priced, as there
 * is then no standard time to compare against.
 */
function addTimingFlags(flags, habitat) {
  const standard = habitat.standardTimeToTargetCondition
  if (!hasStandardTime(standard)) {
    return
  }
  const delay = yearsOrZero(habitat.delayYears)
  const headStart = headStartOrDelayFlag({
    isCreatedArea:
      habitat.category === CREATED && habitat.unitKind === UNIT_KIND.AREA,
    distinctivenessScore: habitat.distinctivenessScore,
    advance: yearsOrZero(habitat.advanceYears),
    delay,
    standard,
    habitat: { type: habitat.type, broadType: habitat.broadType }
  })
  if (headStart) {
    flags.add(headStart)
  }
  if (headStart === ORANGE_FLAG.TARGET_CONDITION_REACHED) {
    flags.add(ORANGE_FLAG.LOW_DIFFICULTY)
  }
  if (exceedsThirtyYears(standard, delay)) {
    flags.add(ORANGE_FLAG.OVER_THIRTY_YEARS)
  }
}

/**
 * The flags a post-intervention habitat raises (AC1-AC10). Only Created and
 * Enhanced habitats raise any: a Retained habitat's flags are its baseline's.
 *
 * @param {{
 *   unitKind: 'area' | 'hedgerow' | 'watercourse',
 *   category: unknown,
 *   type?: unknown,
 *   broadType?: unknown,
 *   condition?: unknown,
 *   advanceYears?: unknown,
 *   delayYears?: unknown,
 *   standardTimeToTargetCondition?: unknown,
 *   distinctivenessScore?: unknown,
 *   baselineBroadType?: unknown
 * }} habitat the proposed side's fields, as priced by the engine, plus
 *   `baselineBroadType` from the baseline habitat it enhances
 * @returns {string[]} flag codes, in code order; empty when none apply
 */
export function derivePostInterventionOrangeFlags(habitat) {
  if (habitat.category !== CREATED && habitat.category !== ENHANCED) {
    return []
  }
  const flags = new Set()
  addTimingFlags(flags, habitat)
  if (raisesFairlyFlag(habitat)) {
    flags.add(ORANGE_FLAG.FAIRLY_CONDITION)
  }
  if (raisesBroadHabitatFlag(habitat)) {
    flags.add(ORANGE_FLAG.BROAD_HABITAT_CHANGE)
  }
  // The metric cannot enhance a watercourse footprint, so such a row never
  // passes import and only a created one can raise FLAG10.
  if (habitat.category === CREATED && raisesFootprintFlag(habitat)) {
    flags.add(ORANGE_FLAG.WATERCOURSE_FOOTPRINT)
  }
  return inCodeOrder(flags)
}

/**
 * @param {Set<string>} flags
 * @returns {string[]}
 */
function inCodeOrder(flags) {
  return ORANGE_FLAG_CODES.filter((code) => flags.has(code))
}
