// Keeps `featureId` stable across re-uploads of a staged GeoPackage.
//
// Same problem and the same answer as ../carry-forward-feature-ids.js, which
// does this for the single-stage format: without it every re-upload mints fresh
// UUIDs, and a downstream relational consumer sees a mass delete-and-reinsert
// instead of an update, losing all row-level history.
//
// The natural keys differ, because the staged format has two of them:
//
//   baseline            hidden `feature_uuid`, falling back to the visible ref
//                       (`Parcel Ref` / `Tree Ref`) for files exported before
//                       the uuid columns existed
//   post-intervention   `PI Ref`
//
// Baseline refs are cosmetic since the uuid columns landed: a surveyor renaming
// a parcel must NOT re-key the feature (a re-key reads as a delete-and-reinsert
// to downstream relational consumers — the exact failure this module exists to
// prevent). `feature_uuid` is stamped once by the template and never edited by
// hand, so it survives renames; the ref fallback keeps pre-uuid files working.
// The two key kinds are prefixed (`uuid:` / `ref:`) so a ref that happens to
// look like a uuid can never cross-match, and a file that gained or lost its
// uuid columns simply matches nothing — conservative, never wrong.
//
// KNOWN LIMITATION: post-intervention rows carry no feature_uuid of their own —
// their `parent_uuid` is the PARENT's key, not this row's — so the PI side
// stays keyed on `PI Ref`. A renamed PI ref therefore still re-keys that one
// feature. `PI Ref` is otherwise sound: the template's tidy-refs action
// guarantees it is unique within the layer and reproduces the same value on
// the same feature.
//
// The stage is part of the lookup key. A retained parcel keeps its parent's ref
// on the post-intervention side (PI Ref "PR-1", Parent Ref "PR-1" in the
// fixture), and a PI row's parent_uuid equals its baseline parent's
// feature_uuid — so neither ref nor uuid alone disambiguates baseline from PI.
//
// Matching stays as conservative as the existing module: a key carries an id
// forward only when it is non-blank and unambiguous on BOTH sides. Uniqueness
// is enforced nowhere for hedgerows, watercourses or trees, so repeated refs are
// possible and a repeat cannot say which feature owns the stored id. Anything
// blank, ambiguous or unmatched gets a fresh UUID, exactly as before.
//
// Called from the staged persistence path
// (services/upload/save-staged-upload-for-project.js), which rebuilds the
// staged `stored` shape this module reads from the persisted project document
// before a re-upload is transformed and saved.

import { randomUUID } from 'node:crypto'

import { normaliseRef } from '../carry-forward-feature-ids.js'
import { STAGE } from './staged-layer-names.js'

/**
 * The red line is one feature per file, so it has no ref and is looked up on
 * its own key — the same arrangement as RED_LINE_KEY in the single-stage module.
 */
export const STAGED_RED_LINE_KEY = 'redLine'

/**
 * Only the first red line feature is the document's boundary; a file carrying
 * more than one is already rejected by the format gate.
 */
const FIRST_RED_LINE_INDEX = 0

/**
 * @param {string} stage
 * @param {string} type
 * @param {string} naturalKey kind-prefixed natural key (`uuid:…` / `ref:…`)
 * @returns {string}
 */
export function stagedLookupKey(stage, type, naturalKey) {
  return `${stage}:${type}:${naturalKey}`
}

/** Key-kind prefixes keep uuid keys and ref keys from ever cross-matching. */
const KEY_KIND_UUID = 'uuid'
const KEY_KIND_REF = 'ref'

/**
 * The key a feature is matched on: the hidden `feature_uuid` on the baseline
 * (ref fallback for pre-uuid files), `PI Ref` post-intervention — see the
 * module comment for why the two sides differ.
 *
 * @param {object} feature
 * @param {string} stage
 * @returns {string | null}
 */
function naturalKey(feature, stage) {
  if (stage === STAGE.POST_INTERVENTION) {
    const piRef = normaliseRef(feature?.piRef)
    return piRef === null ? null : `${KEY_KIND_REF}:${piRef}`
  }
  const uuid = normaliseRef(feature?.featureUuid)
  if (uuid !== null) {
    return `${KEY_KIND_UUID}:${uuid}`
  }
  const ref = normaliseRef(feature?.ref)
  return ref === null ? null : `${KEY_KIND_REF}:${ref}`
}

/**
 * Natural keys appearing exactly once in a layer. Anything repeated is
 * dropped: a key held by two features cannot say which of them owns the
 * stored id.
 *
 * @param {object[]} features
 * @param {string} stage
 * @returns {Set<string>}
 */
function unambiguousKeys(features, stage) {
  const counts = new Map()
  for (const feature of features) {
    const key = naturalKey(feature, stage)
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const unique = new Set()
  for (const [key, count] of counts) {
    if (count === 1) {
      unique.add(key)
    }
  }
  return unique
}

/**
 * @param {Map<string, string>} map
 * @param {string} stage
 * @param {Record<string, object[]> | undefined} byType
 */
function addStageEntries(map, stage, byType) {
  for (const [type, features] of Object.entries(byType ?? {})) {
    if (!Array.isArray(features)) {
      continue
    }
    const unique = unambiguousKeys(features, stage)
    for (const feature of features) {
      const key = naturalKey(feature, stage)
      if (key !== null && unique.has(key) && feature?.featureId) {
        map.set(stagedLookupKey(stage, type, key), feature.featureId)
      }
    }
  }
}

/**
 * Build the (stage, type, ref) → featureId lookup from a previously stored
 * staged document.
 *
 * @param {object | null | undefined} stored
 * @returns {Map<string, string>} empty when there is nothing stored yet
 */
export function buildStagedFeatureIdByRef(stored) {
  const featureIdByRef = new Map()
  if (!stored) {
    return featureIdByRef
  }
  addStageEntries(featureIdByRef, STAGE.BASELINE, stored.baseline)
  addStageEntries(
    featureIdByRef,
    STAGE.POST_INTERVENTION,
    stored.postIntervention
  )
  const redLineFeatureId = stored.redline?.[FIRST_RED_LINE_INDEX]?.featureId
  if (redLineFeatureId) {
    featureIdByRef.set(STAGED_RED_LINE_KEY, redLineFeatureId)
  }
  return featureIdByRef
}

/**
 * @param {object[]} features
 * @param {string} stage
 * @param {string} type
 * @param {Map<string, string>} featureIdByRef
 * @returns {object[]}
 */
function assignLayer(features, stage, type, featureIdByRef) {
  const unique = unambiguousKeys(features, stage)
  return features.map((feature) => {
    const key = naturalKey(feature, stage)
    const carried =
      key !== null && unique.has(key)
        ? featureIdByRef.get(stagedLookupKey(stage, type, key))
        : null
    return { ...feature, featureId: carried ?? randomUUID() }
  })
}

/**
 * @param {Record<string, object[]>} byType
 * @param {string} stage
 * @param {Map<string, string>} featureIdByRef
 * @returns {Record<string, object[]>}
 */
function assignStage(byType, stage, featureIdByRef) {
  const result = {}
  for (const [type, features] of Object.entries(byType ?? {})) {
    result[type] = Array.isArray(features)
      ? assignLayer(features, stage, type, featureIdByRef)
      : features
  }
  return result
}

/**
 * Stamp a `featureId` onto every feature of a staged read, reusing the ids
 * already stored wherever the natural key matches unambiguously.
 *
 * Returns a new object with cloned features; the input is untouched.
 *
 * @param {object} staged output of readStagedGeoPackage
 * @param {Map<string, string>} [featureIdByRef] from buildStagedFeatureIdByRef
 * @returns {object} the same shape, with featureId on every feature
 */
export function assignStagedFeatureIds(staged, featureIdByRef = new Map()) {
  const storedRedLineId = featureIdByRef.get(STAGED_RED_LINE_KEY)
  return {
    ...staged,
    redline: (staged.redline ?? []).map((feature, index) => ({
      ...feature,
      featureId:
        (index === FIRST_RED_LINE_INDEX ? storedRedLineId : null) ??
        randomUUID()
    })),
    baseline: assignStage(staged.baseline, STAGE.BASELINE, featureIdByRef),
    postIntervention: assignStage(
      staged.postIntervention,
      STAGE.POST_INTERVENTION,
      featureIdByRef
    )
  }
}
