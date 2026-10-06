// The hedgerow trading-rules Met / Not-met statuses, derived on read.
//
// Same arrangement as the area-habitat and watercourse statuses: a pure
// function of figures the document already carries, so they are not persisted.
// The band rules and the aggregate use the library primitives, so a consumer
// cannot read one band on its own and report a site compliant that another
// band fails.
//
// Hedgerows trade three bands — Medium, Low and Very Low — and the figures
// cascade: availability carries down from Medium to Low, and from Low to Very
// Low, only while it is positive.

import {
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  TRADING_RULE_NOT_MET,
  combineTradingRuleStatuses,
  tradingRuleStatus
} from 'bng-library/metric'

import { noTradingRuleVerdict } from './trading-rule-verdict.js'

const MEDIUM_BAND = 'Medium'
const LOW_BAND = 'Low'
/** Spelled as the reference data spells it. */
const VERY_LOW_BAND = 'V.Low'
const DEFICIT_THRESHOLD = 0

/** Every band underived, and no verdict to give. */
function noHedgerowVerdict() {
  return { ...noTradingRuleVerdict(), veryLow: null }
}

/**
 * Baseline hedgerows. A stored document lists them; a report site model only
 * has a count, which answers "are there any" but not "which bands".
 *
 * @param {object | null | undefined} baselineDocument
 * @returns {{ hedgerows: object[], bandsKnown: boolean }}
 */
function baselineHedgerowsOf(baselineDocument) {
  if (Array.isArray(baselineDocument?.hedgerows)) {
    return { hedgerows: baselineDocument.hedgerows, bandsKnown: true }
  }
  const count = baselineDocument?.documentCounts?.hedgerows ?? 0
  return { hedgerows: count > 0 ? [{}] : [], bandsKnown: false }
}

/**
 * A baseline hedgerow's band: the one enrichment stored on it, or failing that
 * the reference band for its type.
 *
 * @param {object} hedgerow
 * @returns {string | undefined}
 */
function bandOf(hedgerow) {
  if (typeof hedgerow?.distinctiveness === 'string') {
    return hedgerow.distinctiveness
  }
  const type = hedgerow?.type
  return typeof type === 'string' &&
    Object.hasOwn(HEDGEROW_DISTINCTIVENESS_CATEGORIES, type)
    ? HEDGEROW_DISTINCTIVENESS_CATEGORIES[type]
    : undefined
}

/**
 * @param {object[]} hedgerows
 * @param {string} band
 * @returns {boolean}
 */
function hasBand(hedgerows, band) {
  return hedgerows.some((hedgerow) => bandOf(hedgerow) === band)
}

/**
 * @param {number | null | undefined} figure
 * @returns {string} Met unless the figure is in deficit
 */
function statusOf(figure) {
  return tradingRuleStatus((figure ?? 0) >= DEFICIT_THRESHOLD)
}

/**
 * Both files uploaded, and the figures calculated.
 *
 *  - Medium is Not met when the Medium net unit change is below zero.
 *  - Low is Not met when Low cumulative availability is below zero.
 *  - Very Low is Not met when Very Low cumulative availability is below zero.
 *  - Overall is Not met when any band is.
 *
 * A band is reported only where it applies: Medium where a Medium hedgerow
 * type appears on either side, Low and Very Low where the baseline holds a
 * hedgerow of that band. The overall verdict is taken from all three band
 * rules regardless. That changes nothing when the bands are known — a band
 * with nothing in it on the baseline cannot be in deficit — but it keeps the
 * verdict sound when they are not (a report site model, which only has a
 * count), where skipping a band could hide a Not met.
 *
 * @param {object} figures `tradingRules.hedgerows`
 * @param {{ hedgerows: object[], bandsKnown: boolean }} baseline
 * @returns {{ medium: string|null, low: string|null, veryLow: string|null, overall: string }}
 */
function statusesFromFigures(figures, { hedgerows, bandsKnown }) {
  const medium = statusOf(figures?.medium?.netUnitChange)
  const low = statusOf(figures?.low?.cumulativeAvailability)
  const veryLow = statusOf(figures?.veryLow?.cumulativeAvailability)

  const hasMedium = (figures?.habitatTypes ?? []).some(
    (habitatType) => habitatType?.distinctiveness === MEDIUM_BAND
  )

  return {
    medium: hasMedium ? medium : null,
    low: bandsKnown && hasBand(hedgerows, LOW_BAND) ? low : null,
    veryLow: bandsKnown && hasBand(hedgerows, VERY_LOW_BAND) ? veryLow : null,
    overall: combineTradingRuleStatuses([medium, low, veryLow])
  }
}

/**
 * The statuses for a project's hedgerows.
 *
 *  - **No post-intervention document, and the baseline has a hedgerow.**
 *    Overall is Not met: nothing has been delivered to trade against. No band
 *    is derived, each band rule needing both files.
 *  - **No hedgerows on the baseline.** Trading rules do not apply, whether or
 *    not the post-intervention file adds any, so every status is null.
 *  - **A post-intervention document with trading-rules figures.** The band
 *    rules decide.
 *  - **A post-intervention document without them.** Every status is null:
 *    unknown, which is not the same as failed.
 *
 * @param {object | null | undefined} postInterventionDocument
 * @param {object | null | undefined} [baselineDocument]
 * @returns {{ medium: string|null, low: string|null, veryLow: string|null, overall: string|null }}
 */
export function hedgerowTradingRuleStatuses(
  postInterventionDocument,
  baselineDocument
) {
  const baseline = baselineHedgerowsOf(baselineDocument)

  if (baseline.hedgerows.length === 0) {
    return noHedgerowVerdict()
  }

  if (!postInterventionDocument) {
    return { ...noHedgerowVerdict(), overall: TRADING_RULE_NOT_MET }
  }

  const figures = postInterventionDocument.tradingRules?.hedgerows
  if (!figures) {
    return noHedgerowVerdict()
  }

  return statusesFromFigures(figures, baseline)
}
