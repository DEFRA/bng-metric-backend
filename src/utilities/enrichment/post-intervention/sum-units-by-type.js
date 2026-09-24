// Shared aggregation for post-intervention trading-rules enrichers.
//
// Both modules sum already-computed units by the habitat type a feature
// delivers into, then hand the totals to a bng-library calculator. A type the
// reference data does not know is warned and left out, so the two modules
// cannot drift on what an unknown habitat does to a total.

import {
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'

/**
 * The side of a post-intervention feature whose habitat its units are
 * attributed to. Enhancement and creation deliver into the proposed habitat; a
 * retained feature keeps its baseline habitat (its proposed columns may be an
 * "N/A" placeholder, so the baseline type is authoritative).
 *
 * @param {object} feature
 * @returns {object}
 */
export function deliveredSideOf(feature) {
  if (resolveRetentionCategory(feature) === RETENTION_RETAINED) {
    return feature?.baseline ?? {}
  }
  return feature?.proposed ?? {}
}

/**
 * The habitat type as it can safely appear in a log line.
 *
 * The value is whatever the GeoPackage carried, so it is not necessarily a
 * string. Every branch returns one, and `String()` is only ever handed a
 * primitive, so nothing can reach the log as "[object Object]" — which would
 * name nothing an operator could act on. Nothing here throws either: a log
 * line must never be the thing that fails an upload.
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
  if (
    typeof rawType === 'number' ||
    typeof rawType === 'boolean' ||
    typeof rawType === 'bigint'
  ) {
    return String(rawType)
  }
  try {
    return JSON.stringify(rawType) ?? ''
  } catch {
    return ''
  }
}

/**
 * Add a feature's units to the running total for its type. Non-finite units
 * are skipped with no warning. A type the reference data rejects is warned
 * and skipped, so an Incomplete or unrecognised row never enters the totals.
 *
 * @param {Record<string, number>} unitsByType mutated
 * @param {object} feature
 * @param {{ type?: string | null, raw?: unknown }} resolved
 * @param {(type: string | null | undefined) => boolean} isKnownType
 * @param {{ warn: (msg: string) => void }} logger
 * @param {string} logPrefix
 */
function addFeatureUnits(
  unitsByType,
  feature,
  resolved,
  isKnownType,
  logger,
  logPrefix
) {
  const units = feature?.units
  if (typeof units !== 'number' || !Number.isFinite(units)) {
    return
  }
  const type = resolved?.type
  if (!isKnownType(type)) {
    const featureId = feature?.featureId ?? 'unknown'
    const described = describeType(resolved?.raw)
    logger.warn(
      `${logPrefix}featureId ${featureId}: habitat type '${described}' is not in the reference data, excluded from trading rules`
    )
    return
  }
  unitsByType[type] = (unitsByType[type] ?? 0) + units
}

/**
 * Sum finite units by the type `typeOf` resolves. `typeOf` returns the
 * aggregation key and the raw value to name in a warning. `isKnownType`
 * rejects keys the reference data does not hold.
 *
 * @param {Array<object[] | undefined>} collections
 * @param {(feature: object) => { type?: string | null, raw?: unknown }} typeOf
 * @param {(type: string | null | undefined) => boolean} isKnownType
 * @param {{ warn: (msg: string) => void }} logger
 * @param {string} [logPrefix]
 * @returns {Record<string, number>}
 */
export function sumUnitsByType(
  collections,
  typeOf,
  isKnownType,
  logger,
  logPrefix = ''
) {
  const unitsByType = {}
  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue
    }
    for (const feature of collection) {
      addFeatureUnits(
        unitsByType,
        feature,
        typeOf(feature),
        isKnownType,
        logger,
        logPrefix
      )
    }
  }
  return unitsByType
}
