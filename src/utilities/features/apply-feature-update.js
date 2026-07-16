// Single entry point for "user edited a project feature, persist the new
// derived shape." Used by baseline and post-intervention PUT routes. Pure —
// does no I/O. Callers wrap the result in their own transaction and write the
// project document back.
//
// Producing the updated feature set goes through one path so:
//
//   - every feature type carries the same persisted derived shape
//     (distinctiveness / distinctivenessScore / conditionScore / units /
//     status), avoiding the kind of write-path drift that left BMD-480
//     writing `habitatUnits` while everything else reads `units`,
//   - per-feature totals always refresh after an edit
//     (the BMD-480 area route shipped without this and the habitat-list
//     summary header went stale after a save), and
//   - adding a new feature type later means adding one recompute function,
//     not a new persistence path.

import {
  recomputeAreaHabitat,
  recomputeHedgerow,
  recomputeWatercourse
} from '../../validation/baseline/unit-calculation.js'
import { recomputePostInterventionAreaHabitat } from '../../validation/baseline/recompute-post-intervention-area-habitat.js'

import {
  addPostInterventionNetUnitChanges,
  summarizeFeatureSetUnitsTotals
} from './feature-set-units.js'
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
  } else {
    const trimmed = typeof value === 'string' ? value.trim() : value
    if (trimmed === '') {
      return null
    } else {
      return trimmed
    }
  }
}

function normalizeEdits(edits = {}) {
  return {
    broadType: blankToNull(edits.broadType),
    habitatType: blankToNull(edits.habitatType),
    condition: blankToNull(edits.condition),
    watercourseEncroachment: blankToNull(edits.watercourseEncroachment),
    riparianEncroachment: blankToNull(edits.riparianEncroachment)
  }
}

function recomputeForType(type, existing, edits, documentKey) {
  if (type === 'habitat') {
    if (documentKey === 'postIntervention') {
      return recomputePostInterventionAreaHabitat(existing, {
        broadType: edits.broadType,
        habitatType: edits.habitatType,
        condition: edits.condition
      })
    }
    return recomputeAreaHabitat({
      broadType: edits.broadType,
      habitatType: edits.habitatType,
      condition: edits.condition,
      sizeSquareMetres: existing.sizeSquareMetres ?? existing.area ?? null
    })
  } else if (type === 'hedgerow') {
    return recomputeHedgerow({
      habitatType: edits.habitatType,
      condition: edits.condition,
      sizeMetres: existing.sizeMetres ?? null
    })
  } else if (type === 'watercourse') {
    // Post-intervention watercourse editing is out of scope; only the baseline
    // document recomputes a watercourse here (BMD-597).
    if (documentKey === 'postIntervention') {
      return null
    }
    return recomputeWatercourse({
      habitatType: edits.habitatType,
      condition: edits.condition,
      watercourseEncroachment: edits.watercourseEncroachment,
      riparianEncroachment: edits.riparianEncroachment,
      sizeMetres: existing.sizeMetres ?? null
    })
  } else {
    return null
  }
}

function mergeBaselineFeature(type, existing, edits, derived) {
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
    return { ...base, broadType: edits.broadType, type: edits.habitatType }
  } else if (type === 'watercourse') {
    return {
      ...base,
      type: edits.habitatType,
      watercourseEncroachment: edits.watercourseEncroachment,
      riparianEncroachment: edits.riparianEncroachment,
      waterEncroachmentMultiplier: derived.waterEncroachmentMultiplier ?? null,
      riparianEncroachmentMultiplier:
        derived.riparianEncroachmentMultiplier ?? null
    }
  } else {
    return { ...base, type: edits.habitatType }
  }
}

function mergePostInterventionFeature(type, existing, edits, derived) {
  const updatedProposed = {
    ...existing.proposed,
    condition: edits.condition,
    distinctiveness: derived.distinctiveness,
    distinctivenessScore: derived.distinctivenessScore,
    conditionScore: derived.conditionScore
  }
  if (derived.timeMultiplier != null) {
    updatedProposed.timeMultiplier = derived.timeMultiplier
  }
  if (derived.difficultyMultiplier != null) {
    updatedProposed.difficultyMultiplier = derived.difficultyMultiplier
  }
  if (type === 'habitat') {
    updatedProposed.broadType = edits.broadType
    updatedProposed.type = edits.habitatType
  } else {
    updatedProposed.type = edits.habitatType
  }
  return {
    ...existing,
    units: derived.units,
    status: derived.status,
    proposed: updatedProposed
  }
}

function mergeFeature(type, existing, edits, derived, documentKey) {
  if (documentKey === 'postIntervention') {
    return mergePostInterventionFeature(type, existing, edits, derived)
  } else {
    return mergeBaselineFeature(type, existing, edits, derived)
  }
}

function spliceFeatureInFeatureSet(
  featureSet,
  layerKey,
  index,
  updatedFeature
) {
  const layer = featureSet[layerKey]
  const updatedLayer = layer.slice()
  updatedLayer[index] = updatedFeature
  return {
    ...featureSet,
    [layerKey]: updatedLayer
  }
}

/**
 * Given a project document, locate `featureId`, recompute its derived block
 * from the supplied edits, splice it back into its layer, and refresh the
 * feature-set unit totals. Returns the updated project plus the updated
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
  } else if (expectedType && found.type !== expectedType) {
    return { status: APPLY_RESULT.FEATURE_WRONG_TYPE, type: found.type }
  } else {
    const derived = recomputeForType(
      found.type,
      found.feature,
      normalizedEdits,
      documentKey
    )
    if (derived) {
      const updatedFeature =
        documentKey === 'postIntervention' &&
        found.type === 'habitat' &&
        derived.updatedFeature
          ? derived.updatedFeature
          : mergeFeature(
              found.type,
              found.feature,
              normalizedEdits,
              derived,
              documentKey
            )
      const index = featureSet[found.key].findIndex(
        (f) => f?.featureId === featureId
      )
      const updatedFeatureSet = spliceFeatureInFeatureSet(
        featureSet,
        found.key,
        index,
        updatedFeature
      )
      summarizeFeatureSetUnitsTotals(updatedFeatureSet)
      if (documentKey === 'postIntervention') {
        addPostInterventionNetUnitChanges(
          updatedFeatureSet,
          project?.baseline?.units
        )
      }
      // `layer` / `index` / `unitsTotals` let callers persist surgically via
      // persist-project.js (jsonb_set the one feature + the totals) rather than
      // rewriting the whole document. `project` is retained for callers/tests that
      // want the fully-rebuilt document.
      return {
        status: APPLY_RESULT.OK,
        type: found.type,
        layer: found.key,
        index,
        feature: updatedFeature,
        unitsTotals: updatedFeatureSet.units,
        project: { ...project, [documentKey]: updatedFeatureSet }
      }
    } else {
      return { status: APPLY_RESULT.UNSUPPORTED_TYPE, type: found.type }
    }
  }
}

export { applyFeatureUpdate, APPLY_RESULT }
