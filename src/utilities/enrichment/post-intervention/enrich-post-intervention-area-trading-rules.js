// Post-intervention area-habitat trading-rules enrichment.
//
// Runs after per-feature units and the unit totals are in place. It aggregates
// the already-computed unit figures by engine habitat key, then calls the
// bng-library/metric area trading-rules calculator and writes the result under
// `postInterventionDocument.tradingRules.areaHabitats`.
//
// Two things are easy to get wrong here:
//
//  - Individual trees are area habitats. They live in their own `trees` array
//    but the reference data keys them as "Individual trees - Urban tree" /
//    "- Rural tree", so they aggregate alongside habitat parcels.
//  - Baseline units per habitat come from the project's stored baseline
//    document, not the post-intervention one. An area parcel recorded as Lost
//    in the GeoPackage is persisted as Created, so its baseline units cannot be
//    reconstructed from the post-intervention feature set.
//
// This module persists the unit figures only. The Met / Not-met statuses are a
// pure function of them and are derived on read — see
// `utilities/project/area-trading-rule-statuses.js`. Storing a derivation of
// stored data would buy nothing and go stale the first time a rule changed.

import {
  calculateAreaHabitatTradingRules,
  DISTINCTIVENESS_CATEGORIES
} from 'bng-library/metric'

import { NO_OP_LOGGER } from '../shared/enrich-units-shared.js'
import { engineHabitatTypeCandidates } from '../shared/engine-helpers.js'
import { deliveredSideOf, sumUnitsByType } from './sum-units-by-type.js'

const LOG_PREFIX = 'enrichAreaTradingRules: '

/**
 * The engine reference key for a habitat, trying the same candidates the unit
 * calculation tries: the raw type first, then "{Broad habitat} - {Type}".
 *
 * @param {{ type?: unknown, broadType?: unknown }} habitatProxy
 * @returns {string | null} the first candidate the reference data knows, else null
 */
function engineHabitatKey(habitatProxy) {
  for (const candidate of engineHabitatTypeCandidates(habitatProxy)) {
    if (Object.hasOwn(DISTINCTIVENESS_CATEGORIES, candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * @param {string | null | undefined} type
 * @returns {boolean}
 */
function isKnownAreaType(type) {
  return (
    typeof type === 'string' && Object.hasOwn(DISTINCTIVENESS_CATEGORIES, type)
  )
}

/**
 * @param {(feature: object) => object} sideOf
 * @returns {(feature: object) => { type: string | null, raw: unknown }}
 */
function areaTypeOf(sideOf) {
  return (feature) => {
    const proxy = sideOf(feature)
    return { type: engineHabitatKey(proxy), raw: proxy?.type }
  }
}

/**
 * Mutates `postInterventionDocument`: computes the area-habitat trading-rules
 * unit figures and stores them under
 * `postInterventionDocument.tradingRules.areaHabitats`.
 *
 * The figures are the net unit change per habitat type, the cumulative change
 * per broad habitat for the Medium band with the two intertidals merged, that
 * band's surplus and deficit, the Low band's net change, and the units left
 * available to the Low band once the Medium surplus is carried down.
 *
 * @param {{ habitats?: object[], trees?: object[], tradingRules?: object }} postInterventionDocument
 * @param {{ habitats?: object[], trees?: object[] }} [baselineDocument] the stored baseline
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {typeof postInterventionDocument}
 */
export function enrichPostInterventionAreaTradingRules(
  postInterventionDocument,
  baselineDocument = {},
  logger = NO_OP_LOGGER
) {
  const deliveredUnitsByType = sumUnitsByType(
    [postInterventionDocument?.habitats, postInterventionDocument?.trees],
    areaTypeOf(deliveredSideOf),
    isKnownAreaType,
    logger,
    LOG_PREFIX
  )
  const baselineUnitsByType = sumUnitsByType(
    [baselineDocument?.habitats, baselineDocument?.trees],
    areaTypeOf((feature) => feature ?? {}),
    isKnownAreaType,
    logger,
    LOG_PREFIX
  )

  postInterventionDocument.tradingRules = {
    ...postInterventionDocument.tradingRules,
    areaHabitats: calculateAreaHabitatTradingRules(
      baselineUnitsByType,
      deliveredUnitsByType
    )
  }
  return postInterventionDocument
}
