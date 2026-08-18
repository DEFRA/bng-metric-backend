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
  stagedBaselineDriftedWarning,
  stagedFeaturesRemovedWarning,
  stagedMissingBaselineLayerError,
  stagedParentInferredWarning,
  stagedParentOversubscribedError,
  stagedPiOutsideParentError,
  stagedSizeMismatchError,
  stagedUnknownParentRefError
} from './error-builders.js'
import { geometryChecksum } from './geometry-checksum.js'
import { readStagedGeoPackage } from './read-staged-geopackage.js'
import {
  isLinearMeasure,
  reconcileParents,
  reconcileSize
} from './reconcile.js'
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
  const knownUuids = new Set(
    baseline.map((f) => f?.featureUuid).filter(Boolean)
  )
  const offenders = []
  for (const feature of postIntervention) {
    const parentRef = feature?.parentRef
    const parentUuid = feature?.parentUuid
    const hasStamp =
      (parentRef != null && parentRef !== '') ||
      (parentUuid != null && parentUuid !== '')
    const resolves =
      (parentUuid != null && knownUuids.has(parentUuid)) ||
      (parentRef != null && known.has(parentRef))
    if (hasStamp && !resolves) {
      offenders.push({
        type,
        pi_ref: feature?.piRef ?? null,
        parent_ref: parentRef ?? parentUuid
      })
    }
  }
  return offenders
}

/** Retention categories that continue baseline habitat and so need a parent. */
const CONTINUING_CATEGORIES = new Set(['Retained', 'Enhanced'])

/**
 * Post-intervention rows stamped with a resolving parent_uuid whose checksum
 * no longer matches any baseline row carrying that uuid — the baseline was
 * edited after the copy. Grouped per parent so a parcel split into ten pieces
 * reports one drift, not ten.
 *
 * @param {string} type
 * @param {object[]} postIntervention
 * @param {object[]} baseline
 * @returns {Array<{ type: string, parent_ref: string, pi_count: number }>}
 */
function baselineDrift(type, postIntervention, baseline) {
  const rowsByUuid = new Map()
  for (const feature of baseline) {
    if (!feature?.featureUuid) {
      continue
    }
    const list = rowsByUuid.get(feature.featureUuid) ?? []
    list.push(feature)
    rowsByUuid.set(feature.featureUuid, list)
  }
  const drifted = new Map()
  for (const feature of postIntervention) {
    const uuid = feature?.parentUuid
    const stamped = feature?.parentChecksum
    const rows = uuid ? rowsByUuid.get(uuid) : undefined
    if (!stamped || !rows) {
      continue
    }
    const current = rows.map((row) => geometryChecksum(row.geometry))
    if (!current.includes(stamped)) {
      const ref = rows[0]?.ref ?? uuid
      const entry = drifted.get(ref) ?? { type, parent_ref: ref, pi_count: 0 }
      entry.pi_count += 1
      drifted.set(ref, entry)
    }
  }
  return [...drifted.values()]
}

/**
 * Continuing rows whose parent had to be inferred from geometry because they
 * carry no stamp at all. The inference is a guess to confirm, not a record.
 *
 * @param {string} type
 * @param {object[]} postIntervention
 * @param {object[]} lineage aligned with postIntervention by piIndex
 * @returns {Array<{ type: string, pi_ref: string|null, parent_ref: string|null }>}
 */
function inferredParents(type, postIntervention, lineage) {
  const inferred = []
  for (const entry of lineage) {
    if (entry.source === 'stamped') {
      continue
    }
    const feature = postIntervention[entry.piIndex]
    if (!CONTINUING_CATEGORIES.has(feature?.retentionCategory)) {
      continue
    }
    inferred.push({
      type,
      pi_ref: feature?.piRef ?? null,
      parent_ref: entry.parents[0]?.ref ?? null
    })
  }
  return inferred
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
  const findings = {
    unknownParents: [],
    outsideParent: [],
    removed: [],
    oversubscribed: [],
    drifted: [],
    inferred: []
  }
  const baseline = staged.baseline[type] ?? []

  if (postIntervention.length === 0) {
    // An empty post-intervention layer is not a pass: every baseline feature
    // of a SHORTFALL/PRESENCE type is now unaccounted for, and the surveyor
    // should be told the lot will read as removed.
    const parents = await reconcileParents(pool, type, baseline, [])
    findings.removed = parents.removed
    return findings
  }

  if (staged.baseline[type] === undefined) {
    findings.missingBaseline = type
    return findings
  }

  findings.unknownParents = unknownParentRefs(type, postIntervention, baseline)
  findings.drifted = baselineDrift(type, postIntervention, baseline)

  const lineage = await deriveLineage(pool, postIntervention, baseline, {
    linear: isLinearMeasure(type)
  })
  findings.inferred = inferredParents(type, postIntervention, lineage)
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

  const parents = await reconcileParents(pool, type, baseline, postIntervention)
  findings.removed = parents.removed
  findings.oversubscribed = parents.oversubscribed
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

  const oversubscribed = perType.flatMap((findings) => findings.oversubscribed)
  if (oversubscribed.length > 0) {
    errors.push(stagedParentOversubscribedError(oversubscribed))
  }
  return errors
}

/**
 * Advisory findings that must not fail the upload. Removal-by-absence is the
 * intended way to record a demolished wall, grubbed-out hedge or felled tree,
 * so the file stays valid — but the surveyor gets told what the calculation
 * will assume.
 *
 * @param {object[]} perType
 * @returns {Array<{ code: string, message: string, details?: object }>}
 */
function buildWarnings(perType) {
  const warnings = []
  const removed = perType.flatMap((findings) => findings.removed)
  if (removed.length > 0) {
    warnings.push(stagedFeaturesRemovedWarning(removed))
  }
  const drifted = perType.flatMap((findings) => findings.drifted)
  if (drifted.length > 0) {
    warnings.push(stagedBaselineDriftedWarning(drifted))
  }
  const inferred = perType.flatMap((findings) => findings.inferred)
  if (inferred.length > 0) {
    warnings.push(stagedParentInferredWarning(inferred))
  }
  return warnings
}

/**
 * Validate a staged GeoPackage.
 *
 * @param {string} filePath path to the .gpkg on local disk
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ valid: boolean, errors: Array<{ code: string, message: string, details?: object }>, warnings: Array<{ code: string, message: string, details?: object }>, staged: object }>}
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
  const warnings = buildWarnings(perType)
  return { valid: errors.length === 0, errors, warnings, staged }
}
