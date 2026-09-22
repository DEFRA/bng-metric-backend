// The area-habitat trading-rules Met / Not-met statuses, derived on read.
//
// They are a pure function of the unit figures the post-intervention document
// already carries, and deriving them costs a handful of comparisons — so they
// are not persisted. Storing them would buy nothing and go stale the first time
// a rule changed, leaving every existing project carrying the old verdict.
//
// The rules themselves live in bng-library, not here. The Low band rule reads a
// figure that deliberately differs from the metric spreadsheet and is only safe
// when paired with the Medium band rule, so a consumer applying it alone would
// report a site compliant that the spreadsheet reports short. One derivation,
// called by every consumer: this service's project API, and the site report.

import { deriveAreaHabitatTradingRuleStatuses } from 'bng-library/metric'

/** Neither band derived, and no verdict to give. */
const UNKNOWN = Object.freeze({ medium: null, low: null, overall: null })

/**
 * The statuses for a project's area habitats.
 *
 * Three cases, and the difference between the last two matters:
 *
 *  - **No post-intervention document.** Nothing has been delivered to trade
 *    against, so the overall status is Not met and neither band is derived.
 *  - **A post-intervention document with trading-rules figures.** The engine
 *    decides.
 *  - **A post-intervention document without them** — uploaded before the
 *    figures were calculated, or a calculation that failed. Every status is
 *    null: the answer is unknown, which is not the same as failed. Callers show
 *    nothing rather than a red "Not met" claiming the site was assessed.
 *
 * @param {object} [postInterventionDocument] the stored post-intervention document
 * @returns {{ medium: string|null, low: string|null, overall: string|null }}
 */
export function areaTradingRuleStatuses(postInterventionDocument) {
  if (!postInterventionDocument) {
    return deriveAreaHabitatTradingRuleStatuses(undefined, {
      postInterventionUploaded: false
    })
  }

  const figures = postInterventionDocument.tradingRules?.areaHabitats
  if (!figures) {
    return { ...UNKNOWN }
  }

  return deriveAreaHabitatTradingRuleStatuses(figures, {
    postInterventionUploaded: true
  })
}
