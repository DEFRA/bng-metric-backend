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

import {
  isLegacyLostLinear,
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'

/** Used when no logger is supplied; a dropped feature is then simply dropped. */
const NO_OP_LOGGER = { warn: () => {} }

const LOG_PREFIX = 'enrichHedgerowTradingRules: '

/**
 * The habitat type a post-intervention hedgerow's units are attributed to.
 * Enhancement and creation deliver into the proposed habitat; a retained
 * hedgerow keeps its baseline habitat (its proposed columns may be an "N/A"
 * placeholder, so the baseline type is authoritative).
 *
 * @param {object} feature
 * @returns {unknown}
 */
function deliveredTypeOf(feature) {
  if (resolveRetentionCategory(feature) === RETENTION_RETAINED) {
    return feature?.baseline?.type
  }
  return feature?.proposed?.type
}

/**
 * The habitat type as it can safely appear in a log line: whatever the
 * GeoPackage carried, never "[object Object]", and never a throw.
 *
 * @param {unknown} rawType
 * @returns {string}
 */
function describeType(rawType) {
  if (typeof rawType === 'string') {
    return rawType
  }
  if (rawType == null) {
    return ''
  }
  try {
    return JSON.stringify(rawType) ?? ''
  } catch {
    return ''
  }
}

/**
 * Sum the finite `units` of each feature by its habitat type. Features with a
 * non-finite unit value are skipped, mirroring the leniency of the unit
 * summariser so an Incomplete row never poisons an aggregate with NaN. A type
 * the hedgerow reference data does not know is logged and skipped.
 *
 * @param {object[] | undefined} features
 * @param {(feature: object) => unknown} typeOf
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {Record<string, number>} type -> summed units
 */
function sumUnitsByType(features, typeOf, logger) {
  const unitsByType = {}
  if (!Array.isArray(features)) {
    return unitsByType
  }
  for (const feature of features) {
    const units = feature?.units
    if (typeof units !== 'number' || !Number.isFinite(units)) {
      continue
    }
    const type = typeOf(feature)
    if (
      typeof type !== 'string' ||
      !Object.hasOwn(HEDGEROW_DISTINCTIVENESS_CATEGORIES, type)
    ) {
      logger.warn(
        `${LOG_PREFIX}featureId ${feature?.featureId ?? 'unknown'}: hedgerow type '${describeType(type)}' is not in the reference data, excluded from trading rules`
      )
      continue
    }
    unitsByType[type] = (unitsByType[type] ?? 0) + units
  }
  return unitsByType
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
  // A legacy stored hedgerow may still carry Lost on its baseline sub-object;
  // it delivers nothing, so it must not surface as a zero-unit delivered type.
  const hedgerows = postInterventionDocument?.hedgerows
  const deliveredHedgerows = Array.isArray(hedgerows)
    ? hedgerows.filter((feature) => !isLegacyLostLinear(feature))
    : []
  const deliveredUnitsByType = sumUnitsByType(
    deliveredHedgerows,
    deliveredTypeOf,
    logger
  )
  const baselineUnitsByType = sumUnitsByType(
    baselineDocument?.hedgerows,
    (feature) => feature?.type,
    logger
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
