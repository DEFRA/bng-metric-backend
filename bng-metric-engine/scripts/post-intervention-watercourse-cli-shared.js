#!/usr/bin/env node

/**
 * Watercourse-specific argument parsers for post-intervention CLI scripts.
 */

import {
  parseOptionalEncroachmentArg,
  peelWatercourseEnhancementLengths
} from './post-intervention-cli-shared.js'

/**
 * Positional args: lengthKm, watercourseType, condition, [watercourseEncroachment], [riparianEncroachment].
 * @param {string[]} args
 * @returns {{ lengthRaw: string, watercourseType: string, condition: string, watercourseEncroachment: string | null, riparianEncroachment: string | null } | null}
 */
export function parseWatercourseRetainedPositionalArgs(args) {
  if (args.length < 3) {
    return null
  }

  const lengthRaw = args[0]
  let condition
  let watercourseEncroachment = null
  let riparianEncroachment = null
  let tailCount = 1

  if (args.length >= 5) {
    riparianEncroachment = parseOptionalEncroachmentArg(args.at(-1))
    watercourseEncroachment = parseOptionalEncroachmentArg(args.at(-2))
    condition = args.at(-3)
    tailCount = 3
  } else if (args.length === 4) {
    watercourseEncroachment = parseOptionalEncroachmentArg(args.at(-1))
    condition = args.at(-2)
    tailCount = 2
  } else {
    condition = args.at(-1)
  }

  const watercourseType = args.slice(1, -tailCount).join(' ').trim()

  if (!watercourseType || !condition) {
    return null
  }

  return {
    lengthRaw,
    watercourseType,
    condition,
    watercourseEncroachment,
    riparianEncroachment
  }
}

/**
 * Positional args: lengthKm, watercourseType, condition, watercourseEncroachment, riparianEncroachment, [advanceYears], [delayYears].
 * @param {string[]} args
 * @returns {{ lengthRaw: string, watercourseType: string, condition: string, watercourseEncroachment: string, riparianEncroachment: string, advanceYears: string, delayYears: string } | null}
 */
export function parseWatercourseCreatedPositionalArgs(args) {
  if (args.length < 5 || args.length === 6) {
    return null
  }

  const lengthRaw = args[0]
  let advanceYears = '0'
  let delayYears = '0'
  let watercourseEncroachment
  let riparianEncroachment
  let condition
  let tailCount

  if (args.length >= 7) {
    delayYears = args.at(-1)
    advanceYears = args.at(-2)
    riparianEncroachment = parseOptionalEncroachmentArg(args.at(-3))
    watercourseEncroachment = parseOptionalEncroachmentArg(args.at(-4))
    condition = args.at(-5)
    tailCount = 5
  } else {
    riparianEncroachment = parseOptionalEncroachmentArg(args.at(-1))
    watercourseEncroachment = parseOptionalEncroachmentArg(args.at(-2))
    condition = args.at(-3)
    tailCount = 3
  }

  const watercourseType = args.slice(1, -tailCount).join(' ').trim()

  if (
    !watercourseType ||
    !condition ||
    !watercourseEncroachment ||
    !riparianEncroachment
  ) {
    return null
  }

  return {
    lengthRaw,
    watercourseType,
    condition,
    watercourseEncroachment,
    riparianEncroachment,
    advanceYears,
    delayYears
  }
}

/**
 * @param {string | undefined} raw
 * @returns {boolean}
 */
function looksLikeWatercourseEncroachmentArg(raw) {
  if (raw === undefined || raw === '') {
    return false
  }
  return (
    raw === '-' ||
    raw === 'Minor' ||
    raw === 'Major' ||
    raw === 'No Encroachment' ||
    raw === 'N/A - Culvert' ||
    raw.includes('Encroachment')
  )
}

/**
 * @param {string | undefined} raw
 * @returns {boolean}
 */
function looksLikeRiparianEncroachmentArg(raw) {
  if (raw === undefined || raw === '') {
    return false
  }
  return raw === '-' || raw.includes('/')
}

/**
 * @param {string[]} args
 * @returns {{ baselineCondition: string, postInterventionCondition: string, watercourseEncroachment: string | null, riparianEncroachment: string | null, advanceYears: string, delayYears: string, leadingSpan: string } | null}
 */
function parseWatercourseEnhancedTailArgs(args) {
  if (args.length < 4) {
    return null
  }

  const delayYears = args.at(-1)
  const advanceYears = args.at(-2)
  let watercourseEncroachment = null
  let riparianEncroachment = null
  let postInterventionCondition
  let baselineCondition
  let tailCount = 4

  if (
    args.length >= 6 &&
    looksLikeWatercourseEncroachmentArg(args.at(-4)) &&
    looksLikeRiparianEncroachmentArg(args.at(-3))
  ) {
    riparianEncroachment = parseOptionalEncroachmentArg(args.at(-3))
    watercourseEncroachment = parseOptionalEncroachmentArg(args.at(-4))
    postInterventionCondition = args.at(-5)
    baselineCondition = args.at(-6)
    tailCount = 6
  } else if (
    args.length >= 5 &&
    looksLikeWatercourseEncroachmentArg(args.at(-3))
  ) {
    watercourseEncroachment = parseOptionalEncroachmentArg(args.at(-3))
    postInterventionCondition = args.at(-4)
    baselineCondition = args.at(-5)
    tailCount = 5
  } else {
    postInterventionCondition = args.at(-3)
    baselineCondition = args.at(-4)
  }

  const leadingSpan = args.slice(0, -tailCount).join(' ').trim()

  if (
    !leadingSpan ||
    !baselineCondition ||
    !postInterventionCondition ||
    !advanceYears ||
    !delayYears
  ) {
    return null
  }

  return {
    leadingSpan,
    baselineCondition,
    postInterventionCondition,
    watercourseEncroachment,
    riparianEncroachment,
    advanceYears,
    delayYears
  }
}

/**
 * Positional args: lengthKm, watercourseType, baselineCondition, postInterventionCondition, [watercourseEncroachment], [riparianEncroachment], advanceYears, delayYears.
 * @param {string[]} args
 * @returns {{ lengthRaw: string, watercourseType: string, baselineCondition: string, postInterventionCondition: string, watercourseEncroachment: string | null, riparianEncroachment: string | null, advanceYears: string, delayYears: string } | null}
 */
export function parseWatercourseEnhancedPositionalArgs(args) {
  if (args.length < 6) {
    return null
  }

  const lengthRaw = args[0]
  const tail = parseWatercourseEnhancedTailArgs(args.slice(1))
  if (!tail) {
    return null
  }

  return {
    lengthRaw,
    watercourseType: tail.leadingSpan,
    baselineCondition: tail.baselineCondition,
    postInterventionCondition: tail.postInterventionCondition,
    watercourseEncroachment: tail.watercourseEncroachment,
    riparianEncroachment: tail.riparianEncroachment,
    advanceYears: tail.advanceYears,
    delayYears: tail.delayYears
  }
}

/**
 * Positional args: baselineLengthKm, [postInterventionLengthKm], baselineWatercourseType,
 * [--,] postInterventionWatercourseType, baselineCondition, postInterventionCondition,
 * [watercourseEncroachment], [riparianEncroachment], advanceYears, delayYears.
 * When postInterventionLengthKm is omitted it defaults to baselineLengthKm.
 * Use "--" between baseline and post-intervention watercourse types when they differ
 * (each may be multiple words). When "--" is omitted, one watercourse type span applies
 * to both baseline and post-intervention.
 * @param {string[]} args
 * @returns {{ baselineLengthRaw: string, postInterventionLengthRaw: string, baselineWatercourseType: string, postInterventionWatercourseType: string, baselineCondition: string, postInterventionCondition: string, watercourseEncroachment: string | null, riparianEncroachment: string | null, advanceYears: string, delayYears: string } | null}
 */
export function parseWatercourseEnhancementPositionalArgs(args) {
  const peeled = peelWatercourseEnhancementLengths(args)
  if (!peeled) {
    return null
  }

  const { baselineLengthRaw, postInterventionLengthRaw, remainder } = peeled
  const separatorIndex = remainder.indexOf('--')

  if (separatorIndex !== -1) {
    const before = remainder.slice(0, separatorIndex)
    const after = remainder.slice(separatorIndex + 1)

    if (before.length < 1 || after.length < 4) {
      return null
    }

    const baselineWatercourseType = before.join(' ').trim()
    const tail = parseWatercourseEnhancedTailArgs(after)
    if (!tail) {
      return null
    }

    return {
      baselineLengthRaw,
      postInterventionLengthRaw,
      baselineWatercourseType,
      postInterventionWatercourseType: tail.leadingSpan,
      baselineCondition: tail.baselineCondition,
      postInterventionCondition: tail.postInterventionCondition,
      watercourseEncroachment: tail.watercourseEncroachment,
      riparianEncroachment: tail.riparianEncroachment,
      advanceYears: tail.advanceYears,
      delayYears: tail.delayYears
    }
  }

  const tail = parseWatercourseEnhancedTailArgs(remainder)
  if (!tail) {
    return null
  }

  return {
    baselineLengthRaw,
    postInterventionLengthRaw,
    baselineWatercourseType: tail.leadingSpan,
    postInterventionWatercourseType: tail.leadingSpan,
    baselineCondition: tail.baselineCondition,
    postInterventionCondition: tail.postInterventionCondition,
    watercourseEncroachment: tail.watercourseEncroachment,
    riparianEncroachment: tail.riparianEncroachment,
    advanceYears: tail.advanceYears,
    delayYears: tail.delayYears
  }
}
