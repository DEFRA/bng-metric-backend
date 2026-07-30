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
// treated as a natural key elsewhere: duplicate-ref-check.js enforces its
// uniqueness on the habitats layer, and buildBaselineLinearLengthByRef joins
// post-intervention linear features back to the baseline on it.
//
// Matching is deliberately conservative. A ref only carries an id forward when
// it is non-blank and unambiguous on BOTH sides — uniqueness is only *enforced*
// on habitats, so hedgerows, watercourses and trees can legitimately arrive with
// repeated refs. Anything unmatched, blank or ambiguous falls back to a fresh
// UUID, exactly as before.
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
 * Trim a ref to a comparable string, collapsing blank and missing values to
 * null. Refs reach us as whatever the GeoPackage column held, so a numeric ref
 * must stringify the same way on both sides of the comparison.
 *
 * @param {unknown} ref
 * @returns {string | null}
 */
export function normaliseRef(ref) {
  if (ref === null || ref === undefined) {
    return null
  }
  const trimmed = String(ref).trim()
  return trimmed === '' ? null : trimmed
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
 * (project.baseline or project.postIntervention).
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
  const redLineFeatureId = storedDocument[RED_LINE_KEY]?.featureId
  if (redLineFeatureId) {
    featureIdByRef.set(RED_LINE_KEY, redLineFeatureId)
  }
  return featureIdByRef
}
