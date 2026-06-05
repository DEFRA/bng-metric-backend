// Single entry point for "user edited a baseline feature, persist the new
// derived shape." Used by both the area PUT (BMD-480) and the unified
// hedgerow/feature PUT (BMD-501). Pure — does no I/O. Callers wrap the result
// in their own transaction and write the project document back.
//
// Producing the updated baseline document goes through one path so:
//
//   - every feature type carries the same persisted derived shape
//     (distinctiveness / distinctivenessScore / conditionScore / units /
//     status), avoiding the kind of write-path drift that left BMD-480
//     writing `habitatUnits` while everything else reads `units`,
//   - per-feature totals on `baseline.units` always refresh after an edit
//     (the BMD-480 area route shipped without this and the habitat-list
//     summary header went stale after a save), and
//   - adding a new feature type later means adding one recompute function,
//     not a new persistence path.

import {
  recomputeAreaHabitat,
  recomputeHedgerow
} from '../../validation/baseline/unit-calculation.js'

import { summarizeBaselineUnitsTotals } from './enrich-baseline-units.js'
import { findFeature } from './find-feature.js'

/**
 * Outcome codes for callers. `featureWrongType` distinguishes "the URL
 * promised an area habitat but the featureId points at a hedgerow" from
 * "feature does not exist" so legacy typed routes can keep returning 404 for
 * cross-layer access.
 */
const APPLY_RESULT = Object.freeze({
  OK: 'ok',
  FEATURE_NOT_FOUND: 'featureNotFound',
  FEATURE_WRONG_TYPE: 'featureWrongType',
  UNSUPPORTED_TYPE: 'unsupportedType'
})

function blankToNull(value) {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed === '' ? null : trimmed
}

function normalizeEdits(edits = {}) {
  return {
    broadType: blankToNull(edits.broadType),
    habitatType: blankToNull(edits.habitatType),
    condition: blankToNull(edits.condition)
  }
}

function recomputeForType(type, existing, edits) {
  if (type === 'habitat') {
    return recomputeAreaHabitat({
      broadType: edits.broadType,
      habitatType: edits.habitatType,
      condition: edits.condition,
      sizeSquareMetres: existing.sizeSquareMetres ?? null
    })
  }
  if (type === 'hedgerow') {
    return recomputeHedgerow({
      habitatType: edits.habitatType,
      condition: edits.condition,
      sizeMetres: existing.sizeMetres ?? null
    })
  }
  return null
}

function mergeFeature(type, existing, edits, derived) {
  const base = {
    ...existing,
    condition: edits.condition,
    distinctiveness: derived.distinctiveness,
    distinctivenessScore: derived.distinctivenessScore,
    conditionScore: derived.conditionScore,
    units: derived.units,
    status: derived.status
  }
  if (type === 'habitat') {
    return {
      ...base,
      broadType: edits.broadType,
      type: edits.habitatType
    }
  }
  // hedgerow (and future watercourse) — single habitat-type field, no broad.
  return {
    ...base,
    type: edits.habitatType
  }
}

function spliceFeatureInBaseline(
  baseline,
  layerKey,
  featureId,
  updatedFeature
) {
  const layer = baseline[layerKey] ?? []
  const idx = layer.findIndex((f) => f?.featureId === featureId)
  const updatedLayer = layer.slice()
  updatedLayer[idx] = updatedFeature
  return {
    ...baseline,
    [layerKey]: updatedLayer
  }
}

/**
 * Given a project document, locate `featureId`, recompute its derived block
 * from the supplied edits, splice it back into its layer, and refresh
 * `baseline.units.*` totals. Returns the updated project plus the updated
 * feature; callers persist the project.
 *
 * `expectedType` lets the legacy typed PUT routes 404 cross-layer access
 * (e.g. hedgerow featureId posted to `/projects/{id}/habitats/{id}`). Omit
 * it on the unified route — the type is whatever the data says it is.
 *
 * @param {object} project — full row.project JSONB
 * @param {object} params
 * @param {string} params.featureId
 * @param {object} params.edits  { broadType?, habitatType?, condition? }
 * @param {string} [params.expectedType]
 * @returns {
 *   { status: 'ok', type: string, project: object, feature: object } |
 *   { status: 'featureNotFound' | 'featureWrongType' | 'unsupportedType', type?: string }
 * }
 */
function applyFeatureUpdate(
  project,
  { featureId, edits, expectedType, documentKey = 'baseline' }
) {
  const normalizedEdits = normalizeEdits(edits)
  const featureSet = project?.[documentKey]
  const found = findFeature(featureSet, featureId)
  if (!found) {
    return { status: APPLY_RESULT.FEATURE_NOT_FOUND }
  }
  if (expectedType && found.type !== expectedType) {
    return { status: APPLY_RESULT.FEATURE_WRONG_TYPE, type: found.type }
  }

  const derived = recomputeForType(found.type, found.feature, normalizedEdits)
  if (!derived) {
    return { status: APPLY_RESULT.UNSUPPORTED_TYPE, type: found.type }
  }

  const updatedFeature = mergeFeature(
    found.type,
    found.feature,
    normalizedEdits,
    derived
  )
  const updatedFeatureSet = spliceFeatureInBaseline(
    featureSet,
    found.key,
    featureId,
    updatedFeature
  )
  summarizeBaselineUnitsTotals(updatedFeatureSet)

  return {
    status: APPLY_RESULT.OK,
    type: found.type,
    project: { ...project, [documentKey]: updatedFeatureSet },
    feature: updatedFeature
  }
}

export { applyFeatureUpdate, APPLY_RESULT }
