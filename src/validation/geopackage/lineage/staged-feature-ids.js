// Keeps `featureId` stable across re-uploads of a staged GeoPackage.
//
// Same problem and the same answer as ../carry-forward-feature-ids.js, which
// does this for the single-stage format: without it every re-upload mints fresh
// UUIDs, and a downstream relational consumer sees a mass delete-and-reinsert
// instead of an update, losing all row-level history.
//
// The natural keys differ, because the staged format has two of them:
//
//   post-intervention   `PI Ref`
//   baseline            `Parcel Ref` / `Tree Ref`
//
// `PI Ref` is a sound key because the template's tidy-refs action guarantees it
// is unique within the layer and reproduces the same value on the same feature.
// That is what makes it safe to match on; nothing else in the file is stable
// across an edit-and-re-export cycle.
//
// The stage is part of the lookup key. A retained parcel keeps its parent's ref
// on the post-intervention side (PI Ref "PR-1", Parent Ref "PR-1" in the
// fixture), so a key without the stage would collapse a baseline parcel and its
// post-intervention counterpart onto one id — two different features, two
// different rows downstream.
//
// Matching stays as conservative as the existing module: a key carries an id
// forward only when it is non-blank and unambiguous on BOTH sides. Uniqueness
// is enforced nowhere for hedgerows, watercourses or trees, so repeated refs are
// possible and a repeat cannot say which feature owns the stored id. Anything
// blank, ambiguous or unmatched gets a fresh UUID, exactly as before.
//
// NOT yet called from anywhere: staged uploads are validated but not persisted
// (see ./README.md), so there is no stored document to carry ids forward from.
// The `stored` argument is whatever a previous run of assignStagedFeatureIds
// produced — the shape a staged document would take when persistence lands.

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
 * @param {string} ref
 * @returns {string}
 */
export function stagedLookupKey(stage, type, ref) {
  return `${stage}:${type}:${ref}`
}

/**
 * The key a feature is matched on: `PI Ref` post-intervention, the feature's own
 * ref (Parcel Ref / Tree Ref) on the baseline.
 *
 * @param {object} feature
 * @param {string} stage
 * @returns {string | null}
 */
function naturalKey(feature, stage) {
  return normaliseRef(
    stage === STAGE.POST_INTERVENTION ? feature?.piRef : feature?.ref
  )
}

/**
 * Refs appearing exactly once in a layer. Anything repeated is dropped: a ref
 * held by two features cannot say which of them owns the stored id.
 *
 * @param {object[]} features
 * @param {string} stage
 * @returns {Set<string>}
 */
function unambiguousRefs(features, stage) {
  const counts = new Map()
  for (const feature of features) {
    const ref = naturalKey(feature, stage)
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
 * @param {Map<string, string>} map
 * @param {string} stage
 * @param {Record<string, object[]> | undefined} byType
 */
function addStageEntries(map, stage, byType) {
  for (const [type, features] of Object.entries(byType ?? {})) {
    if (!Array.isArray(features)) {
      continue
    }
    const unique = unambiguousRefs(features, stage)
    for (const feature of features) {
      const ref = naturalKey(feature, stage)
      if (ref !== null && unique.has(ref) && feature?.featureId) {
        map.set(stagedLookupKey(stage, type, ref), feature.featureId)
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
  const unique = unambiguousRefs(features, stage)
  return features.map((feature) => {
    const ref = naturalKey(feature, stage)
    const carried =
      ref !== null && unique.has(ref)
        ? featureIdByRef.get(stagedLookupKey(stage, type, ref))
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
