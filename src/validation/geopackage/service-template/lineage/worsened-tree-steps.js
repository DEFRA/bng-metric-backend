import { MAX_YEARS } from 'bng-library/metric'

import { isLowerCondition } from './habitat-change.js'

/**
 * The Metric guide's steps for a tree whose condition gets worse ("Habitat
 * retention"), which an Existing tree Created over its baseline tree follows,
 * on upload (lineage-rules.js, checkWorsenedTrees) and on edit
 * (edit-degrade-rule.js, brokenDegradeRule) alike: unless it is put back after
 * a delay, it is in a lower condition than its baseline tree and created 30+
 * years in advance.
 *
 * Each side is a plain description of one tree, its years as numbers:
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
    breaks: (parent, proposed) => !isLowerCondition('trees', parent, proposed)
  },
  {
    rule: DEGRADE_RULE.advance30Plus,
    fields: ['advanceYears', 'delayYears'],
    breaks: (_parent, proposed) => !is30PlusYearsInAdvance(proposed)
  }
])

/** Whether a proposed side breaks a step; a tree put back after a delay breaks none. */
export const breaksCheck = (check, parent, proposed) =>
  !isPutBack(proposed) && check.breaks(parent, proposed)

/**
 * Whether a tree follows every step. One with no condition is Incomplete, as
 * any Created tree is, and is not refused for it.
 *
 * @param {object} parent its baseline tree's side
 * @param {object} proposed its own side
 * @returns {boolean}
 */
export const followsGuide = (parent, proposed) =>
  !proposed.condition ||
  !DEGRADE_CHECKS.some((check) => breaksCheck(check, parent, proposed))
