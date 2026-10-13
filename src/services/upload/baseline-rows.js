// Which GeoPackage rows describe a baseline habitat.
//
// A combined (baseline + post-intervention) file carries one row per
// post-intervention feature, with the pre-development habitat in its Baseline*
// columns. A Created row has no baseline habitat: its Baseline* columns hold a
// placeholder ("To be created", "N/A", ...) or nothing. Every other row —
// Retained, Enhanced and Lost alike — becomes one baseline entry with its own
// geometry, whatever its ref.
//
// A baseline upload only ignores Created rows. A placeholder or blank type on
// any other row is kept, so the user can complete it. The strict filter, used
// when a post-intervention file derives its baseline, drops Created rows and
// Lost rows whose Baseline type is blank or a placeholder. A Retained or
// Enhanced row always has a baseline habitat: a blank or placeholder type
// there is an incomplete file, not a row to discard.

import { PROP_KEYS, pickProp } from '../../validation/geopackage/properties.js'
import {
  GPKG_RETENTION_LOST,
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  normaliseRetentionCategory
} from '../../utilities/enrichment/post-intervention/retention-category.js'

/** Baseline type values that mean "no baseline habitat", compared lower-cased. */
const BASELINE_TYPE_PLACEHOLDERS = new Set([
  'null',
  'n/a',
  '(no selection)',
  'to be created'
])

/** Raw layer key → the column that names the row's baseline habitat. */
const BASELINE_TYPE_KEYS_BY_LAYER = Object.freeze({
  areas: PROP_KEYS.habitatType,
  hedgerows: PROP_KEYS.hedgerowType,
  watercourses: PROP_KEYS.riverType,
  trees: PROP_KEYS.treeSize
})

function isBlank(value) {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

function isPlaceholder(value) {
  return (
    typeof value === 'string' &&
    BASELINE_TYPE_PLACEHOLDERS.has(value.trim().toLowerCase())
  )
}

const RETENTION_WITH_BASELINE_HABITAT = new Set([
  RETENTION_RETAINED,
  RETENTION_ENHANCED
])

function retentionOf(feature) {
  return normaliseRetentionCategory(
    pickProp(feature?.properties ?? {}, PROP_KEYS.retentionCategory)
  )
}

function baselineTypeOf(layerName, feature) {
  return pickProp(
    feature?.properties ?? {},
    BASELINE_TYPE_KEYS_BY_LAYER[layerName]
  )
}

function hasNoBaselineType(value) {
  return isBlank(value) || isPlaceholder(value)
}

/**
 * @param {string} layerName raw layer key (areas, hedgerows, watercourses, trees)
 * @param {object} feature
 * @param {{ strict?: boolean }} [options] `strict` also drops a Lost row whose
 *   baseline type is blank or a placeholder. A baseline file does not: only
 *   Created rows are ignored, and every other row is kept for the user to
 *   complete.
 * @returns {boolean}
 */
export function isBaselineRow(layerName, feature, { strict = false } = {}) {
  const retention = retentionOf(feature)
  if (retention === RETENTION_CREATED) {
    return false
  }
  if (!strict) {
    return true
  }
  return !(
    retention === GPKG_RETENTION_LOST &&
    hasNoBaselineType(baselineTypeOf(layerName, feature))
  )
}

/**
 * Retained and Enhanced rows that have no baseline habitat type. Strict
 * derivation must not drop these: the habitat exists, and omitting it would
 * understate the baseline. A Lost row with a blank type is dropped instead.
 *
 * @param {object} layers
 * @returns {number}
 */
export function countRowsWithoutBaselineType(layers) {
  let count = 0
  for (const layerName of Object.keys(BASELINE_TYPE_KEYS_BY_LAYER)) {
    count += missingBaselineTypeCount(layers?.[layerName], layerName)
  }
  return count
}

function missingBaselineTypeCount(features, layerName) {
  if (!Array.isArray(features)) {
    return 0
  }
  return features.filter((feature) => isMissingBaselineType(layerName, feature))
    .length
}

function isMissingBaselineType(layerName, feature) {
  return (
    RETENTION_WITH_BASELINE_HABITAT.has(retentionOf(feature)) &&
    hasNoBaselineType(baselineTypeOf(layerName, feature))
  )
}

/**
 * Keep only the rows that describe a baseline habitat. The red line and any
 * other layer pass through untouched.
 *
 * Run it after geometry sizes are attached: sizes are keyed by a feature's
 * position, and this filter renumbers what is left.
 *
 * @param {object} layers
 * @param {{ strict?: boolean }} [options] see {@link isBaselineRow}
 * @returns {object} a new layers object
 */
export function filterBaselineLayers(layers, options = {}) {
  const filtered = { ...layers }
  for (const layerName of Object.keys(BASELINE_TYPE_KEYS_BY_LAYER)) {
    if (Array.isArray(layers[layerName])) {
      filtered[layerName] = layers[layerName].filter((feature) =>
        isBaselineRow(layerName, feature, options)
      )
    }
  }
  return filtered
}
