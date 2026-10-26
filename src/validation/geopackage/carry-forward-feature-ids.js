// Keeps `featureId` stable when a user re-uploads a GeoPackage over a document
// they have already imported.
//
// Every upload previously stamped a fresh randomUUID() on every feature, and
// setProjectHabitatData replaces the whole baseline / postIntervention subtree —
// so re-uploading a corrected file re-keyed every parcel. For a downstream
// relational consumer (the PowerBI / Synapse integration) that reads as a mass
// delete-and-reinsert rather than an update, and no row-level history survives.
//
// The stable key is `ref` — the Parcel Ref / Tree Ref column. It is already
// treated as a natural key elsewhere: buildBaselineLinearLengthByRef joins
// post-intervention linear features back to the baseline on it.
//
// Matching is deliberately conservative. A ref only carries an id forward when
// it is non-blank and unambiguous on BOTH sides — uniqueness is not enforced on
// any layer (BMD-1058 allows habitats to share a ref), so any layer can
// legitimately arrive with repeated refs. Anything unmatched, blank or
// ambiguous falls back to a fresh UUID, exactly as before.
//
// A BNG Service template feature also carries its own `feature_uuid`, which a
// split feature does not share with its parent as it shares the Habitat Ref.
// It is matched against the uuids stored for this project, under keys of their
// own, and never used as the id itself: the geometry tables' primary key spans
// every project, and the file, and so the uuid, is the user's.
import { FEATURE_UUID } from 'bng-library/bng-service'

import { cleanHabitatRef } from './habitat-ref-check.js'
import { PROP_KEYS } from './properties.js'

/**
 * Document layer name → the PROP_KEYS candidate list holding that layer's
 * feature reference in the raw GeoPackage properties. Both columns are read
 * from the same source column regardless of baseline / post-intervention
 * variant (see SHARED_FEATURE_KEYS in properties.js).
 */
export const REF_PROP_KEYS_BY_LAYER = Object.freeze({
  habitats: PROP_KEYS.parcelRef,
  hedgerows: PROP_KEYS.parcelRef,
  watercourses: PROP_KEYS.parcelRef,
  trees: PROP_KEYS.treeRef
})

/**
 * The red line boundary is one feature per document, so it needs no ref — it is
 * stored under this key on its own.
 */
export const RED_LINE_KEY = 'redLine'

/**
 * Clean a ref to a comparable string, collapsing blank, missing and non-scalar
 * values to null. It is cleaned exactly as a habitat ref is stored (trimmed and
 * truncated, cleanHabitatRef), so an incoming ref and the stored one it came
 * from compare equal however long it was. Refs reach us as whatever the
 * GeoPackage column held, so a
 * numeric ref must stringify the same way on both sides of the comparison —
 * but anything that is not a string or number has no meaningful ref value, and
 * stringifying it would collapse every such feature onto one lookup key
 * ('[object Object]') and match them to each other.
 *
 * @param {unknown} ref
 * @returns {string | null}
 */
export function normaliseRef(ref) {
  if (typeof ref !== 'string' && typeof ref !== 'number') {
    return null
  }
  const cleaned = cleanHabitatRef(ref)
  return cleaned === '' ? null : cleaned
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A feature's `feature_uuid`, lower-cased, when it holds a valid one.
 *
 * @param {object | undefined} properties
 * @returns {string | null}
 */
export function featureUuidOf(properties) {
  const uuid = properties?.[FEATURE_UUID]
  return typeof uuid === 'string' && UUID_PATTERN.test(uuid)
    ? uuid.toLowerCase()
    : null
}

/**
 * @param {string} uuid as featureUuidOf gives it
 * @returns {string}
 */
export function featureUuidLookupKey(uuid) {
  return `${FEATURE_UUID}:${uuid}`
}

/**
 * Record the stored features' uuids against their featureIds, across every
 * layer, dropping any uuid two features carry.
 *
 * @param {Map<string, string>} map
 * @param {object} storedDocument
 */
function addFeatureUuidEntries(map, storedDocument) {
  const idByUuid = new Map()
  const duplicated = new Set()
  for (const layer of Object.keys(REF_PROP_KEYS_BY_LAYER)) {
    const features = storedDocument[layer]
    for (const feature of Array.isArray(features) ? features : []) {
      const uuid = featureUuidOf(feature?.properties)
      if (uuid === null || !feature?.featureId) {
        continue
      }
      if (idByUuid.has(uuid)) {
        duplicated.add(uuid)
      } else {
        idByUuid.set(uuid, feature.featureId)
      }
    }
  }
  for (const [uuid, featureId] of idByUuid) {
    if (!duplicated.has(uuid)) {
      map.set(featureUuidLookupKey(uuid), featureId)
    }
  }
}

/**
 * @param {string} layer document layer name
 * @param {string} ref normalised ref
 * @returns {string}
 */
export function refLookupKey(layer, ref) {
  return `${layer}:${ref}`
}

/**
 * Record one stored layer's refs against their featureIds, skipping blank refs
 * and dropping any ref carried by more than one feature — a shared ref cannot
 * say which feature owns the id.
 *
 * @param {Map<string, string>} map
 * @param {string} layer
 * @param {object[] | undefined} features
 */
function addLayerEntries(map, layer, features) {
  if (!Array.isArray(features)) {
    return
  }
  const idByRef = new Map()
  const duplicated = new Set()
  for (const feature of features) {
    const ref = normaliseRef(feature?.ref)
    if (ref === null || !feature?.featureId) {
      continue
    }
    if (idByRef.has(ref)) {
      duplicated.add(ref)
    } else {
      idByRef.set(ref, feature.featureId)
    }
  }
  for (const [ref, featureId] of idByRef) {
    if (!duplicated.has(ref)) {
      map.set(refLookupKey(layer, ref), featureId)
    }
  }
}

/**
 * Build the ref → featureId lookup for one stored document subtree
 * (project.baseline or project.postIntervention), with each stored
 * feature_uuid → featureId under featureUuidLookupKey.
 *
 * @param {object | null | undefined} storedDocument
 * @returns {Map<string, string>} empty when there is nothing stored yet
 */
export function buildFeatureIdByRef(storedDocument) {
  const featureIdByRef = new Map()
  if (!storedDocument) {
    return featureIdByRef
  }
  for (const layer of Object.keys(REF_PROP_KEYS_BY_LAYER)) {
    addLayerEntries(featureIdByRef, layer, storedDocument[layer])
  }
  addFeatureUuidEntries(featureIdByRef, storedDocument)
  const redLineFeatureId = storedDocument[RED_LINE_KEY]?.featureId
  if (redLineFeatureId) {
    featureIdByRef.set(RED_LINE_KEY, redLineFeatureId)
  }
  return featureIdByRef
}
