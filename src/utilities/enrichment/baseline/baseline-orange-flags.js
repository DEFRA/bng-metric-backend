// Reads a baseline feature's own fields into the shared orange-flag rules
// (BMD-822). A baseline habitat raises FLAG7 and FLAG10 only.

import {
  ORANGE_FLAG_UNIT_KIND_BY_LAYER,
  applyOrangeFlagsToDocument,
  deriveBaselineOrangeFlags
} from '../shared/orange-flags.js'

/**
 * @param {{ type?: unknown, broadType?: unknown, condition?: unknown }} feature
 * @param {string} layerKey the document layer the feature is in, e.g. 'habitats'
 * @returns {string[]}
 */
export function baselineFeatureOrangeFlags(feature, layerKey) {
  return deriveBaselineOrangeFlags({
    unitKind: ORANGE_FLAG_UNIT_KIND_BY_LAYER[layerKey],
    type: feature.type,
    broadType: feature.broadType,
    condition: feature.condition
  })
}

/**
 * Sets `orangeFlags` on every feature of a baseline document.
 *
 * @param {object | undefined} baselineDocument
 */
export function applyBaselineOrangeFlags(baselineDocument) {
  applyOrangeFlagsToDocument(baselineDocument, baselineFeatureOrangeFlags)
}
