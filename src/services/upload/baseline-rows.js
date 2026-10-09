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
// when a post-intervention file derives its baseline, treats those values as
// "no baseline habitat" and drops the row.

import { PROP_KEYS, pickProp } from '../../validation/geopackage/properties.js'
import {
  RETENTION_CREATED,
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

/**
 * @param {string} layerName raw layer key (areas, hedgerows, watercourses, trees)
 * @param {object} feature
 * @param {{ strict?: boolean }} [options] `strict` also rejects a blank or
 *   placeholder baseline type. A post-intervention file uses it, because there
 *   those values mean "no baseline". A baseline file keeps them so the user
 *   can complete the row.
 * @returns {boolean}
 */
export function isBaselineRow(layerName, feature, { strict = false } = {}) {
  const props = feature?.properties ?? {}
  const retention = normaliseRetentionCategory(
    pickProp(props, PROP_KEYS.retentionCategory)
  )
  if (retention === RETENTION_CREATED) {
    return false
  }
  if (!strict) {
    return true
  }
  const baselineType = pickProp(props, BASELINE_TYPE_KEYS_BY_LAYER[layerName])
  return !isPlaceholder(baselineType) && !isBlank(baselineType)
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
