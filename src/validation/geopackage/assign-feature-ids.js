import { randomUUID } from 'node:crypto'

import {
  REF_PROP_KEYS_BY_LAYER,
  RED_LINE_KEY,
  featureUuidLookupKey,
  featureUuidOf,
  normaliseRef,
  refLookupKey
} from './carry-forward-feature-ids.js'
import { pickProp } from './properties.js'

/**
 * Raw layer key (as returned by readGeoPackage) → the layer name used
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
const noCarryForward = () => null

/**
 * The BNG Service template gives every baseline feature a `feature_uuid`, which
 * is its stable identity: a split feature keeps its parent's Habitat Ref, so
 * the ref cannot be. The uuids that appear exactly once in the file, across
 * every layer. One shared by two features cannot say which it belongs to, so
 * neither uses it. A legacy file has none.
 *
 * @param {object} layers
 * @returns {Set<string>}
 */
function uniqueFileFeatureUuids(layers) {
  const counts = new Map()
  for (const features of Object.values(layers)) {
    if (!Array.isArray(features)) {
      continue
    }
    for (const feature of features) {
      const uuid = featureUuidOf(feature?.properties)
      if (uuid) {
        counts.set(uuid, (counts.get(uuid) ?? 0) + 1)
      }
    }
  }
  return new Set(
    [...counts].filter(([, count]) => count === 1).map(([uuid]) => uuid)
  )
}

/**
 * How a feature with a unique uuid in the file finds its id: the id stored
 * for that uuid in this project, if any. Also the ids those matches claim, so
 * that no feature without one is given the same id by its ref.
 *
 * @param {object} layers
 * @param {Map<string, string>} featureIdByRef
 * @returns {{ ownUuid: (feature: object) => string | null,
 *   storedIdFor: (uuid: string) => string | undefined,
 *   claimed: Set<string> }}
 */
function fileUuidMatching(layers, featureIdByRef) {
  const unique = uniqueFileFeatureUuids(layers)
  const storedIdFor = (uuid) => featureIdByRef.get(featureUuidLookupKey(uuid))
  const claimed = new Set(
    [...unique].map(storedIdFor).filter((featureId) => featureId)
  )
  return {
    ownUuid: (feature) => {
      const uuid = featureUuidOf(feature?.properties)
      return unique.has(uuid) ? uuid : null
    },
    storedIdFor,
    claimed
  }
}

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
    return noCarryForward
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
    return noCarryForward
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
 * @param {ReturnType<typeof fileUuidMatching>} uuids
 * @returns {object[]}
 */
function assignLayerFeatureIds(rawLayerName, features, featureIdByRef, uuids) {
  const documentLayer = RAW_TO_DOCUMENT_LAYER[rawLayerName]
  const existingFeatureId = carryForwardLookup(
    documentLayer,
    features,
    featureIdByRef
  )
  const featureIdFor = (feature, index) => {
    const uuid = uuids.ownUuid(feature)
    if (uuid) {
      return uuids.storedIdFor(uuid) ?? randomUUID()
    }
    const byRef = existingFeatureId(feature, index)
    return byRef && !uuids.claimed.has(byRef) ? byRef : randomUUID()
  }
  return features.map((feature, index) => {
    // `missingLayers` is an array of plain layer-name strings, not features.
    // Spreading one would explode it into { 0: 'H', 1: 'a', ... }.
    if (feature === null || typeof feature !== 'object') {
      return feature
    }
    return { ...feature, featureId: featureIdFor(feature, index) }
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
 * A BNG Service template feature whose `feature_uuid` is valid and unique in
 * the file is matched on it alone: the id stored for that uuid in this
 * project, or a fresh UUID. The uuid is never the id itself, as the geometry
 * tables' primary key spans every project.
 *
 * @param {object} layers  The raw layers object from readGeoPackage.
 * @param {Map<string, string>} [featureIdByRef]  ref → existing featureId.
 * @returns {object}       New layers object with featureId on every feature.
 */
export function assignFeatureIds(layers, featureIdByRef = new Map()) {
  const uuids = fileUuidMatching(layers, featureIdByRef)
  const result = {}
  for (const [layerName, features] of Object.entries(layers)) {
    result[layerName] = Array.isArray(features)
      ? assignLayerFeatureIds(layerName, features, featureIdByRef, uuids)
      : features
  }
  return result
}
