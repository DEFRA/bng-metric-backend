// Validation entry point for the staged GeoPackage format — the one the upload
// routes call. Reads the file, derives baseline → post-intervention lineage per
// habitat type, and reconciles, returning the same `{ valid, errors }` shape
// the single-stage path returns so the route needs no second response format.
//
// What this does NOT do yet, deliberately:
//
//   * It does not run the PostGIS geometry suite (redline containment, parcel
//     overlaps, area sums). That suite reads `readGeoPackage`'s feature shape,
//     including a native SRID per feature, which readStagedGeoPackage does not
//     carry. Adapting it is a separate piece of work; until then a staged file
//     gets lineage checks only. See ./README.md.
//   * It does not persist. The stored document has one baseline subtree and one
//     post-intervention subtree written by separate uploads; a single staged
//     file writing both is a schema question, not a validation one.

import { checkContainment } from './containment.js'
import { deriveLineage } from './derive-lineage.js'
import {
  stagedMissingBaselineLayerError,
  stagedPiOutsideParentError,
  stagedSizeMismatchError,
  stagedUnknownParentRefError
} from './error-builders.js'
import { readStagedGeoPackage } from './read-staged-geopackage.js'
import { isLinearMeasure, reconcileSize } from './reconcile.js'
import { HABITAT_TYPES } from './staged-layer-names.js'

/**
 * Refs carried by at least one baseline feature of this type. A stamped parent
 * outside this set is a broken reference, not a lineage decision.
 *
 * @param {object[]} baseline
 * @returns {Set<string>}
 */
function baselineRefSet(baseline) {
  const refs = new Set()
  for (const feature of baseline) {
    if (feature?.ref != null && feature.ref !== '') {
      refs.add(feature.ref)
    }
  }
  return refs
}

/**
 * Post-intervention features whose stamped `Parent Ref` names nothing in the
 * baseline.
 *
 * Worth its own error rather than letting deriveLineage handle it: that
 * function falls through to the geometry rule when a stamp does not resolve, so
 * the feature quietly acquires a plausible parent it was never meant to have.
 * A dangling ref means the file has been edited outside the template's own
 * actions, and the user needs to know.
 *
 * @param {string} type
 * @param {object[]} postIntervention
 * @param {object[]} baseline
 * @returns {Array<{ type: string, pi_ref: string|null, parent_ref: string }>}
 */
function unknownParentRefs(type, postIntervention, baseline) {
  const known = baselineRefSet(baseline)
  const offenders = []
  for (const feature of postIntervention) {
    const parentRef = feature?.parentRef
    if (parentRef != null && parentRef !== '' && !known.has(parentRef)) {
      offenders.push({
        type,
        pi_ref: feature?.piRef ?? null,
        parent_ref: parentRef
      })
    }
  }
  return offenders
}

/**
 * Findings for one habitat type. Types are checked independently: a broken
 * hedgerow layer should not stop the area habitats being reported on, because
 * the surveyor will want to fix everything in one pass.
 *
 * @param {import('pg').Pool} pool
 * @param {string} type
 * @param {object} staged output of readStagedGeoPackage
 * @returns {Promise<{ missingBaseline?: string, unknownParents: object[], outsideParent: object[], sizeMismatch?: object }>}
 */
async function checkType(pool, type, staged) {
  const postIntervention = staged.postIntervention[type] ?? []
  const findings = { unknownParents: [], outsideParent: [] }
  if (postIntervention.length === 0) {
    return findings
  }

  const baseline = staged.baseline[type]
  if (baseline === undefined) {
    findings.missingBaseline = type
    return findings
  }

  findings.unknownParents = unknownParentRefs(type, postIntervention, baseline)

  const lineage = await deriveLineage(pool, postIntervention, baseline, {
    linear: isLinearMeasure(type)
  })
  // checkContainment returns [] for the exempt types, so the policy lives in one
  // place rather than being re-stated as a condition here.
  findings.outsideParent = await checkContainment(pool, type, {
    postIntervention,
    baseline,
    lineage
  })

  const reconciled = await reconcileSize(pool, type, baseline, postIntervention)
  if (reconciled.checked && !reconciled.withinTolerance) {
    findings.sizeMismatch = {
      type,
      measure: reconciled.measure,
      baseline_total: reconciled.baselineTotal,
      pi_total: reconciled.piTotal,
      delta: reconciled.delta
    }
  }
  return findings
}

/**
 * Collapse per-type findings into one error per code, so a file with three
 * broken layers produces three errors rather than nine.
 *
 * @param {object[]} perType
 * @returns {Array<{ code: string, message: string, details?: object }>}
 */
function buildErrors(perType) {
  const errors = []
  const missingBaseline = perType
    .map((findings) => findings.missingBaseline)
    .filter(Boolean)
  if (missingBaseline.length > 0) {
    errors.push(stagedMissingBaselineLayerError(missingBaseline))
  }

  const unknownParents = perType.flatMap((findings) => findings.unknownParents)
  if (unknownParents.length > 0) {
    errors.push(stagedUnknownParentRefError(unknownParents))
  }

  const outsideParent = perType.flatMap((findings) => findings.outsideParent)
  if (outsideParent.length > 0) {
    errors.push(stagedPiOutsideParentError(outsideParent))
  }

  const sizeMismatches = perType
    .map((findings) => findings.sizeMismatch)
    .filter(Boolean)
  if (sizeMismatches.length > 0) {
    errors.push(stagedSizeMismatchError(sizeMismatches))
  }
  return errors
}

/**
 * Validate a staged GeoPackage.
 *
 * @param {string} filePath path to the .gpkg on local disk
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ valid: boolean, errors: Array<{ code: string, message: string, details?: object }>, staged: object }>}
 */
export async function validateStagedGeoPackage(filePath, pool) {
  if (!pool) {
    throw new Error('validateStagedGeoPackage requires a pg pool')
  }
  const staged = readStagedGeoPackage(filePath)

  // Sequential rather than Promise.all: each type costs two small queries, and
  // a single upload should not take five connections out of the request pool.
  const perType = []
  for (const type of Object.values(HABITAT_TYPES)) {
    perType.push(await checkType(pool, type, staged))
  }

  const errors = buildErrors(perType)
  return { valid: errors.length === 0, errors, staged }
}
