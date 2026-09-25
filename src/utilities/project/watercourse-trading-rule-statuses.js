// The watercourse trading-rules Met / Not-met statuses, derived on read.
//
// Same arrangement as the area-habitat statuses: a pure function of figures
// the document already carries, so they are not persisted. The band rules and
// the aggregate use the library primitives, so a consumer cannot apply the Low
// band on its own and report a site compliant that the Medium band fails.

import {
  TRADING_RULE_NOT_MET,
  combineTradingRuleStatuses,
  tradingRuleStatus
} from 'bng-library/metric'

import { noTradingRuleVerdict } from './trading-rule-verdict.js'

const MEDIUM_BAND = 'Medium'
const LOW_BAND = 'Low'
const DEFICIT_THRESHOLD = 0

/**
 * Baseline watercourses, for the "which bands exist" question asked when no
 * post-intervention file has been uploaded. A stored document lists them; a
 * site model only has a count, and a feature with no band still counts as a
 * watercourse for the overall status.
 *
 * @param {object | null | undefined} baselineDocument
 * @returns {object[]}
 */
function baselineWatercoursesOf(baselineDocument) {
  if (Array.isArray(baselineDocument?.watercourses)) {
    return baselineDocument.watercourses
  }
  const count = baselineDocument?.documentCounts?.watercourses ?? 0
  return count > 0 ? [{}] : []
}

/**
 * @param {object[]} watercourses
 * @param {string} band
 * @returns {boolean}
 */
function hasBand(watercourses, band) {
  return watercourses.some(
    (watercourse) => watercourse?.distinctiveness === band
  )
}

/**
 * No post-intervention file. Overall is Not met when the baseline has a
 * watercourse to trade. A band is Not met only when that band is present;
 * a band the baseline does not have was not derived.
 *
 * @param {object[]} baselineWatercourses
 * @returns {{ medium: string|null, low: string|null, overall: string|null }}
 */
function statusesWithoutPostIntervention(baselineWatercourses) {
  if (baselineWatercourses.length === 0) {
    return noTradingRuleVerdict()
  }
  return {
    medium: hasBand(baselineWatercourses, MEDIUM_BAND)
      ? TRADING_RULE_NOT_MET
      : null,
    low: hasBand(baselineWatercourses, LOW_BAND) ? TRADING_RULE_NOT_MET : null,
    overall: TRADING_RULE_NOT_MET
  }
}

/**
 * Both files uploaded. Medium is Not met when its deficit is below zero; Low
 * is Not met when cumulative availability is below zero; overall is Not met
 * when either band is.
 *
 * @param {object} figures
 * @returns {{ medium: string, low: string, overall: string }}
 */
function statusesFromFigures(figures) {
  const medium = tradingRuleStatus(
    (figures?.medium?.deficit ?? 0) >= DEFICIT_THRESHOLD
  )
  const low = tradingRuleStatus(
    (figures?.low?.cumulativeAvailability ?? 0) >= DEFICIT_THRESHOLD
  )
  return {
    medium,
    low,
    overall: combineTradingRuleStatuses([medium, low])
  }
}

/**
 * The statuses for a project's watercourses.
 *
 *  - **No post-intervention document, and the baseline has a watercourse.**
 *    Overall is Not met. A band is Not met only when the baseline holds a
 *    watercourse of that distinctiveness.
 *  - **No watercourses on the baseline, and the post-intervention file has
 *    some.** Trading rules do not apply, so every status is null.
 *  - **A post-intervention document with trading-rules figures.** The band
 *    rules decide.
 *  - **A post-intervention document without them.** Every status is null:
 *    unknown, which is not the same as failed.
 *
 * @param {object | null | undefined} postInterventionDocument
 * @param {object | null | undefined} [baselineDocument]
 * @returns {{ medium: string|null, low: string|null, overall: string|null }}
 */
export function watercourseTradingRuleStatuses(
  postInterventionDocument,
  baselineDocument
) {
  const baselineWatercourses = baselineWatercoursesOf(baselineDocument)

  if (!postInterventionDocument) {
    return statusesWithoutPostIntervention(baselineWatercourses)
  }

  // Every AC is preconditioned on a watercourse in the baseline. Without one
  // the rules do not apply, whether or not the post-intervention file adds any:
  // there is nothing there was ever a trade against. Nothing to display.
  if (baselineWatercourses.length === 0) {
    return noTradingRuleVerdict()
  }

  const figures = postInterventionDocument.tradingRules?.watercourses
  if (!figures) {
    return noTradingRuleVerdict()
  }

  return statusesFromFigures(figures)
}
