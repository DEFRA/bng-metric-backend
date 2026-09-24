// Post-intervention watercourse trading-rules enrichment (BMD-995).
//
// Runs after per-feature units and the unit totals are in place. It aggregates
// the already-computed unit figures by habitat type, then calls the
// bng-library/metric watercourse trading-rules calculator and writes the result
// under `postInterventionDocument.tradingRules.watercourses`.
//
// Baseline units per type come from the project's stored baseline document, not
// the post-intervention document: Lost baseline stretches still count towards a
// habitat's baseline total but are excluded from the post-intervention feature
// set, so they cannot be reconstructed from it.
//
// This module derives no Met / Not-met statuses (that is BMD-1002); it persists
// the unit figures only. Hedgerows will add a sibling key under `tradingRules`
// following the same pattern.

import {
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  calculateWatercourseTradingRules
} from 'bng-library/metric'

import { NO_OP_LOGGER } from '../shared/enrich-units-shared.js'
import { deliveredSideOf, sumUnitsByType } from './sum-units-by-type.js'

const LOG_PREFIX = 'enrichWatercourseTradingRules: '

/**
 * @param {string | null | undefined} type
 * @returns {boolean}
 */
function isKnownWatercourseType(type) {
  return (
    typeof type === 'string' &&
    Object.hasOwn(WATERCOURSE_DISTINCTIVENESS_CATEGORIES, type)
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
 * Mutates `postInterventionDocument`: computes the watercourse trading-rules
 * unit figures (AC1 net unit change per habitat, AC2/AC3 Medium surplus and
 * deficit, AC4/AC5 Low net change and cumulative availability) and stores them
 * under `postInterventionDocument.tradingRules.watercourses`.
 *
 * Delivered units are grouped by the habitat type each feature delivers into:
 * the proposed type for created and enhanced features (enhancement moves units
 * between habitats), and the baseline type for retained features. Baseline
 * units are grouped by the baseline watercourse type from the stored baseline
 * document. A type the reference data does not know is warned and excluded.
 *
 * @param {{ watercourses?: object[], tradingRules?: object }} postInterventionDocument
 * @param {object[]} [baselineWatercourses] the stored baseline watercourse features
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {typeof postInterventionDocument}
 */
export function enrichPostInterventionWatercourseTradingRules(
  postInterventionDocument,
  baselineWatercourses = [],
  logger = NO_OP_LOGGER
) {
  const deliveredUnitsByType = sumUnitsByType(
    [postInterventionDocument?.watercourses],
    (feature) => resolvedType(deliveredSideOf(feature)),
    isKnownWatercourseType,
    logger,
    LOG_PREFIX
  )
  const baselineUnitsByType = sumUnitsByType(
    [baselineWatercourses],
    (feature) => resolvedType(feature),
    isKnownWatercourseType,
    logger,
    LOG_PREFIX
  )

  postInterventionDocument.tradingRules = {
    ...postInterventionDocument.tradingRules,
    watercourses: calculateWatercourseTradingRules(
      baselineUnitsByType,
      deliveredUnitsByType
    )
  }
  return postInterventionDocument
}
