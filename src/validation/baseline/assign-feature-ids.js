import { randomUUID } from 'node:crypto'

import {
  REF_PROP_KEYS_BY_LAYER,
  RED_LINE_KEY,
  normaliseRef,
  refLookupKey
} from './carry-forward-feature-ids.js'
import { pickProp } from './properties.js'

/**
 * Raw layer key (as returned by readBaselineGeoPackage) → the layer name used
 * in the persisted document. Only `redline` and `areas` differ. Layers absent
 * from this map (`iggis`, which is validation-only and never persisted) still
 * receive a fresh UUID; they simply have nothing to carry forward.
 */
const RAW_TO_DOCUMENT_LAYER = Object.freeze({
  redline: RED_LINE_KEY,
  areas: 'habitats',
  hedgerows: 'hedgerows',
  watercourses: 'watercourses',
  trees: 'trees'
})

/** Lookup used when a layer has nothing to carry forward. */
const NO_CARRY_FORWARD = () => null

/**
 * Refs appearing exactly once in the incoming layer. A ref shared by two
 * incoming features cannot say which of them owns the stored id, so neither
 * matches and both get a fresh UUID.
 *
 * @param {object[]} features
 * @param {string[]} refPropKeys
 * @returns {Set<string>}
 */
function uniqueIncomingRefs(features, refPropKeys) {
  const counts = new Map()
  for (const feature of features) {
    const ref = normaliseRef(pickProp(feature?.properties, refPropKeys))
    if (ref !== null) {
      counts.set(ref, (counts.get(ref) ?? 0) + 1)
    }
  }
  const unique = new Set()
  for (const [ref, count] of counts) {
    if (count === 1) {
      unique.add(ref)
    }
  }
  return unique
}

/**
 * @param {string} documentLayer
 * @param {object[]} features
 * @param {Map<string, string>} featureIdByRef
 * @returns {(feature: object) => string | null}
 */
function refCarryForward(documentLayer, features, featureIdByRef) {
  const refPropKeys = REF_PROP_KEYS_BY_LAYER[documentLayer]
  const unique = uniqueIncomingRefs(features, refPropKeys)
  return (feature) => {
    const ref = normaliseRef(pickProp(feature?.properties, refPropKeys))
    if (ref === null || !unique.has(ref)) {
      return null
    }
    return featureIdByRef.get(refLookupKey(documentLayer, ref)) ?? null
  }
}

/**
 * Only the first red line feature becomes the document (see buildRedLine), so
 * only that one carries the stored id forward.
 *
 * @param {Map<string, string>} featureIdByRef
 * @returns {(feature: object, index: number) => string | null}
 */
function redLineCarryForward(featureIdByRef) {
  const storedFeatureId = featureIdByRef.get(RED_LINE_KEY)
  if (!storedFeatureId) {
    return NO_CARRY_FORWARD
  }
  return (_feature, index) => (index === 0 ? storedFeatureId : null)
}

/**
 * @param {string | undefined} documentLayer
 * @param {object[]} features
 * @param {Map<string, string>} featureIdByRef
 * @returns {(feature: object, index: number) => string | null}
 */
function carryForwardLookup(documentLayer, features, featureIdByRef) {
  if (!documentLayer || featureIdByRef.size === 0) {
    return NO_CARRY_FORWARD
  }
  if (documentLayer === RED_LINE_KEY) {
    return redLineCarryForward(featureIdByRef)
  }
  return refCarryForward(documentLayer, features, featureIdByRef)
}

/**
 * @param {string} rawLayerName
 * @param {object[]} features
 * @param {Map<string, string>} featureIdByRef
 * @returns {object[]}
 */
function assignLayerFeatureIds(rawLayerName, features, featureIdByRef) {
  const documentLayer = RAW_TO_DOCUMENT_LAYER[rawLayerName]
  const existingFeatureId = carryForwardLookup(
    documentLayer,
    features,
    featureIdByRef
  )
  return features.map((feature, index) => {
    // `missingLayers` is an array of plain layer-name strings, not features.
    // Spreading one would explode it into { 0: 'H', 1: 'a', ... }.
    if (feature === null || typeof feature !== 'object') {
      return feature
    }
    return {
      ...feature,
      featureId: existingFeatureId(feature, index) ?? randomUUID()
    }
  })
}

/**
 * Stamp a `featureId` onto every feature in each layer array. Returns a new
 * layers object with cloned feature objects (originals untouched).
 *
 * Call this once before passing layers to both calculateHabitatSizes and
 * extractHabitatData so both consumers share the same explicit join key rather
 * than relying on a fragile implicit array-position contract.
 *
 * Pass `featureIdByRef` (from buildFeatureIdByRef) to reuse the ids already
 * stored for this project's document, so a re-upload updates the downstream
 * rows rather than replacing them. Omit it and every feature gets a fresh UUID,
 * which is the correct behaviour for a project's first import.
 *
 * @param {object} layers  The raw layers object from readBaselineGeoPackage.
 * @param {Map<string, string>} [featureIdByRef]  ref → existing featureId.
 * @returns {object}       New layers object with featureId on every feature.
 */
export function assignFeatureIds(layers, featureIdByRef = new Map()) {
  const result = {}
  for (const [layerName, features] of Object.entries(layers)) {
    result[layerName] = Array.isArray(features)
      ? assignLayerFeatureIds(layerName, features, featureIdByRef)
      : features
  }
  return result
}
