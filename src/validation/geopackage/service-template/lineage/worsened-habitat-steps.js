import { MAX_YEARS } from 'bng-library/metric'

import { conditionScore, isLowerCondition } from './habitat-change.js'

/**
 * The Metric guide's steps for a habitat whose condition gets worse ("Habitat
 * retention"): record it as lost, and created again in its own type, on its
 * own land, in a lower condition, 30+ years in advance. A habitat cleared and
 * put back gives its delay in starting habitat creation instead (guide,
 * "Advance and delay"), so a row with a delay is held to neither step.
 *
 * Held on upload (lineage-rules.js) and on edit (edit-degrade-rule.js,
 * brokenDegradeRule) alike, to a Created row linked to its baseline parent:
 * an Existing tree Created over its baseline tree, and an area habitat,
 * vertical area habitat or hedgerow Created in its parent's own type.
 *
 * Each side is a plain description of one habitat, its years as numbers:
 * `{ type, broadType, condition, advanceYears, delayYears }`. "30+" is 30
 * years, as the import parses it and the Metric prices it, so 30 meets the
 * step as "30+" does.
 */
export const DEGRADE_RULE = Object.freeze({
  worseCondition: 'degrade-worse-condition',
  advance30Plus: 'degrade-advance-30-plus'
})

/** Put back after a delay: a temporary loss the delay already discounts. */
export const isPutBack = (proposed) => (proposed.delayYears ?? 0) > 0

const is30PlusYearsInAdvance = (proposed) =>
  (proposed.advanceYears ?? 0) >= MAX_YEARS

/**
 * Each step, in the order the upload's message gives them: whether a proposed
 * side breaks it, and the fields an edit changes it by.
 */
export const DEGRADE_CHECKS = Object.freeze([
  {
    rule: DEGRADE_RULE.worseCondition,
    fields: ['condition', 'delayYears'],
    breaks: (layer, parent, proposed) =>
      !isLowerCondition(layer, parent, proposed)
  },
  {
    rule: DEGRADE_RULE.advance30Plus,
    fields: ['advanceYears', 'delayYears'],
    breaks: (_layer, _parent, proposed) => !is30PlusYearsInAdvance(proposed)
  }
])

/** Whether a proposed side breaks a step; one put back after a delay breaks none. */
export const breaksCheck = (check, layer, parent, proposed) =>
  !isPutBack(proposed) && check.breaks(layer, parent, proposed)

/**
 * Whether the steps can judge a row: both its condition and its parent's are
 * ones the Metric scores for their habitat type. One with no condition is
 * Incomplete, as any Created row is, and a condition such as "N/A - Other" or
 * "Condition Assessment N/A" has no lower or higher, so neither is refused.
 *
 * @param {string} layer
 * @param {object} parent its baseline parent's side
 * @param {object} proposed its own side
 * @returns {boolean}
 */
export const isJudged = (layer, parent, proposed) =>
  conditionScore(layer, parent) !== null &&
  conditionScore(layer, proposed) !== null

/**
 * Whether a row follows every step, or is one the steps cannot judge.
 *
 * @param {string} layer
 * @param {object} parent its baseline parent's side
 * @param {object} proposed its own side
 * @returns {boolean}
 */
export const followsGuide = (layer, parent, proposed) =>
  !isJudged(layer, parent, proposed) ||
  !DEGRADE_CHECKS.some((check) => breaksCheck(check, layer, parent, proposed))
