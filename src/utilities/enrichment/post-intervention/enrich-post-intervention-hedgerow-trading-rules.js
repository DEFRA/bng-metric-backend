// Post-intervention hedgerow trading-rules enrichment.
//
// Runs after per-feature units and the unit totals are in place. It aggregates
// the already-computed hedgerow unit figures by habitat type, then calls the
// bng-library/metric hedgerow trading-rules calculator and writes the result
// under `postInterventionDocument.tradingRules.hedgerows`.
//
// Baseline units per type come from the project's stored baseline document, not
// the post-intervention one: a hedgerow recorded as Lost is excluded from the
// post-intervention feature set at extract time, so its baseline units can only
// be found in the baseline.
//
// This module persists the unit figures only. Met / Not-met statuses are a pure
// function of them and belong with the status work, derived on read.

import {
  calculateHedgerowTradingRules,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES
} from 'bng-library/metric'

import { NO_OP_LOGGER } from '../shared/enrich-units-shared.js'
import { isLegacyLostLinear } from './retention-category.js'
import { deliveredSideOf, sumUnitsByType } from './sum-units-by-type.js'

const LOG_PREFIX = 'enrichHedgerowTradingRules: '

/**
 * @param {string | null | undefined} type
 * @returns {boolean}
 */
function isKnownHedgerowType(type) {
  return (
    typeof type === 'string' &&
    Object.hasOwn(HEDGEROW_DISTINCTIVENESS_CATEGORIES, type)
  )
}

/**
 * @param {object | null | undefined} side
 * @returns {{ type: string | null, raw: unknown }}
 */
function resolvedType(side) {
  const type = side?.type
  return { type: typeof type === 'string' ? type : null, raw: type }
}

/**
 * Mutates `postInterventionDocument`: computes the hedgerow trading-rules unit
 * figures and stores them under
 * `postInterventionDocument.tradingRules.hedgerows`.
 *
 * The figures are the net unit change per habitat type, the net change for the
 * Medium, Low and Very Low bands, and the cumulative availability carried down
 * from Medium to Low and from Low to Very Low while it is positive.
 *
 * Delivered units are grouped by the habitat type each feature delivers into:
 * the proposed type for created and enhanced features (enhancement moves units
 * between habitats), and the baseline type for retained features. A legacy
 * stored hedgerow may still carry Lost on its baseline sub-object; it delivers
 * nothing, so it is excluded before it can surface as a zero-unit delivered
 * type. A type the reference data does not know is warned and excluded.
 *
 * @param {{ hedgerows?: object[], tradingRules?: object }} postInterventionDocument
 * @param {{ hedgerows?: object[] }} [baselineDocument] the stored baseline
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {typeof postInterventionDocument}
 */
export function enrichPostInterventionHedgerowTradingRules(
  postInterventionDocument,
  baselineDocument = {},
  logger = NO_OP_LOGGER
) {
  const hedgerows = postInterventionDocument?.hedgerows
  const deliveredHedgerows = Array.isArray(hedgerows)
    ? hedgerows.filter((feature) => !isLegacyLostLinear(feature))
    : []

  const deliveredUnitsByType = sumUnitsByType(
    [deliveredHedgerows],
    (feature) => resolvedType(deliveredSideOf(feature)),
    isKnownHedgerowType,
    logger,
    LOG_PREFIX
  )
  const baselineUnitsByType = sumUnitsByType(
    [baselineDocument?.hedgerows],
    (feature) => resolvedType(feature),
    isKnownHedgerowType,
    logger,
    LOG_PREFIX
  )

  postInterventionDocument.tradingRules = {
    ...postInterventionDocument.tradingRules,
    hedgerows: calculateHedgerowTradingRules(
      baselineUnitsByType,
      deliveredUnitsByType
    )
  }
  return postInterventionDocument
}
