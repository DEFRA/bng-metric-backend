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

import { engineHabitatTypeCandidates } from '../shared/engine-helpers.js'
import {
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'

/** Used when no logger is supplied; a dropped feature is then simply dropped. */
const NO_OP_LOGGER = { warn: () => {} }

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
 * The side of a post-intervention feature whose habitat its units are
 * attributed to. Enhancement and creation deliver into the proposed habitat; a
 * retained feature keeps its baseline habitat (its proposed columns may be an
 * "N/A" placeholder, so the baseline type is authoritative).
 *
 * @param {object} feature
 * @returns {{ type?: unknown, broadType?: unknown }}
 */
function deliveredHabitatOf(feature) {
  if (resolveRetentionCategory(feature) === RETENTION_RETAINED) {
    return feature?.baseline ?? {}
  }
  return feature?.proposed ?? {}
}

/**
 * Add a feature's units to the running total for its habitat key. Features with
 * an unresolvable habitat type or a non-finite unit value are skipped, mirroring
 * the leniency of the unit summariser so an Incomplete row never poisons an
 * aggregate with NaN.
 *
 * @param {Record<string, number>} unitsByType mutated
 * @param {object} feature
 * @param {{ type?: unknown, broadType?: unknown }} habitatProxy
 * @param {{ warn: (msg: string) => void }} logger
 */
function addFeatureUnits(unitsByType, feature, habitatProxy, logger) {
  const units = feature?.units
  if (typeof units !== 'number' || !Number.isFinite(units)) {
    return
  }
  const habitatKey = engineHabitatKey(habitatProxy)
  if (!habitatKey) {
    // The type is whatever the GeoPackage carried, so it is not necessarily a
    // string. Anything else is JSON-stringified rather than left to land in the
    // log as "[object Object]", which names nothing an operator can act on.
    const rawType = habitatProxy?.type
    const reportedType =
      typeof rawType === 'string' || rawType == null
        ? (rawType ?? '')
        : JSON.stringify(rawType)
    logger.warn(
      `${LOG_PREFIX}featureId ${feature?.featureId ?? 'unknown'}: habitat type '${reportedType}' is not in the reference data, excluded from trading rules`
    )
    return
  }
  unitsByType[habitatKey] = (unitsByType[habitatKey] ?? 0) + units
}

/**
 * Sum the units of every feature in each collection, keyed by engine habitat key.
 *
 * @param {Array<object[] | undefined>} collections
 * @param {(feature: object) => ({ type?: unknown, broadType?: unknown })} habitatOf
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {Record<string, number>}
 */
function sumUnitsByHabitat(collections, habitatOf, logger) {
  const unitsByType = {}
  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue
    }
    for (const feature of collection) {
      addFeatureUnits(unitsByType, feature, habitatOf(feature), logger)
    }
  }
  return unitsByType
}

/**
 * Mutates `postInterventionDocument`: computes the area-habitat trading-rules
 * unit figures (AC1 net unit change per habitat, AC2/AC3 cumulative change per
 * broad habitat with the intertidals merged, AC4/AC5 Medium surplus and deficit,
 * AC6 Low net change, AC7 cumulative availability to the Low band) and stores
 * them under `postInterventionDocument.tradingRules.areaHabitats`.
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
  const deliveredUnitsByType = sumUnitsByHabitat(
    [postInterventionDocument?.habitats, postInterventionDocument?.trees],
    deliveredHabitatOf,
    logger
  )
  const baselineUnitsByType = sumUnitsByHabitat(
    [baselineDocument?.habitats, baselineDocument?.trees],
    (feature) => feature ?? {},
    logger
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
