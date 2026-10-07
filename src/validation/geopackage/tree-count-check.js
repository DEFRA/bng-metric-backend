import { ERROR_CODES, makeError } from './errors.js'
import { PROP_KEYS, pickProp } from './properties.js'

const SAMPLE_CAP = 50

/** The column name quoted back to the user, matching the NE template heading. */
const COUNT_COLUMN = PROP_KEYS.treeCount[0]

/** Fewer trees than this cannot stand on a point. */
const MIN_TREE_COUNT = 1

/**
 * A "Count" left empty means the point stands for one tree, which is how the
 * statutory metric reads it. Whitespace counts as empty: a cell cleared in a
 * GIS editor often keeps a space behind.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBlankTreeCount(value) {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

/** Numeric text that spells a count: digits only, give or take whitespace. */
const DIGITS_ONLY = /^\s*\d+\s*$/

/**
 * Whether a filled-in "Count" is a usable number of trees: a whole number of
 * one or more, as a number or as text of plain digits.
 *
 * The template declares the column an integer, so SQLite hands back a number
 * for anything it could read as one. What arrives as text is what it could
 * not: "two", "0x3" and the like. Only digits are taken from text, since
 * `Number("0x3")` is 3 and would price the point as three trees.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWholeTreeCount(value) {
  if (typeof value === 'string') {
    return DIGITS_ONLY.test(value) && Number(value) >= MIN_TREE_COUNT
  }
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= MIN_TREE_COUNT
  )
}

function describeTree(feature, idx) {
  const properties = feature?.properties ?? {}
  const ref = pickProp(properties, PROP_KEYS.treeRef)
  const fid = pickProp(properties, PROP_KEYS.fid)
  return {
    feature_ref: ref == null || ref === '' ? null : String(ref),
    fid: fid == null || fid === '' ? null : fid,
    idx
  }
}

function labelOf(sample) {
  if (sample.feature_ref != null) {
    return `${PROP_KEYS.treeRef[0]} ${sample.feature_ref}`
  }
  if (sample.fid != null) {
    return `fid ${sample.fid}`
  }
  return `feature #${sample.idx}`
}

/**
 * Reject tree points whose "Count" is filled in but is not a whole number of
 * trees.
 *
 * The NE template declares the column an integer, but SQLite keeps a 2.5 as a
 * real, so a hand-edited file can carry one. There is no right way to price
 * it: two trees and three trees are both guesses, and pricing it as one tree
 * silently discards what the user wrote. A blank is not an error, because the
 * metric reads a blank as one tree.
 *
 * @param {object} layers Output of readGeoPackage
 * @returns {{ code: string, message: string, details: { count: number, sample: object[] } }|null}
 */
export function checkTreeCountIsWhole(layers) {
  const offenders = []
  const trees = layers?.trees ?? []
  trees.forEach((feature, idx) => {
    const count = pickProp(feature?.properties ?? {}, PROP_KEYS.treeCount)
    if (!isBlankTreeCount(count) && !isWholeTreeCount(count)) {
      offenders.push({ ...describeTree(feature, idx), count })
    }
  })

  if (offenders.length === 0) {
    return null
  }

  const sample = offenders.slice(0, SAMPLE_CAP)
  const shown = sample
    .map((entry) => `${labelOf(entry)} (${String(entry.count)})`)
    .join(', ')
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''

  return makeError(
    ERROR_CODES.TREE_COUNT_NOT_WHOLE,
    `One or more trees have a "${COUNT_COLUMN}" that is not a whole number of trees (${MIN_TREE_COUNT} or more). Enter how many trees each point stands for, or leave it blank for one tree: ${shown}${more}`,
    { count: offenders.length, sample }
  )
}
