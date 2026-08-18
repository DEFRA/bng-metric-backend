// Reconcile a staged GeoPackage's post-intervention layers against their
// baselines.
//
// The invariant is NOT uniform across habitat types, and applying one rule
// everywhere would reject legitimate work. Established by prototyping each type
// in QGIS, and revised when removal-by-absence replaced removal rows:
//
//   Area habitats     EXACT: totals equal, PI within baseline. Ground inside
//                     the red line cannot vanish — building on it creates the
//                     new surface (developed land / sealed surface), so every
//                     square metre must appear on both sides. An absent parcel
//                     is indistinguishable from a mapping gap.
//   Vertical areas    SHORTFALL: a demolished green wall has no sealed-surface
//                     successor and its footprint line is not ground coverage,
//                     so absence IS the record of demolition. Children may
//                     total less than the parent, never more.
//   Hedgerows         SHORTFALL: the Statutory Metric takes retained/enhanced
//                     lengths per baseline row and derives the lost length as
//                     the residual — it is never entered as a row. A removed
//                     hedge is an absent one; a shortened hedge is a Retained
//                     child drawn shorter.
//   Watercourses      PRESENCE: re-meandering legitimately moves the channel
//                     off the old line and lengthens it, so child lengths say
//                     nothing about how much baseline was lost. A parent with
//                     at least one stamped child is treated as continuing in
//                     full; a parent with none is treated as removed. Partial
//                     loss is expressed by drawing the baseline stretch as two
//                     features at survey time.
//   Trees             SHORTFALL on Count: a felled tree is an absent point; a
//                     baseline point of five trees with two felled is a
//                     Retained child with Count 3.
//
// Shortfall is a WARNING (`removed`), not an error: the copy action populates
// post-intervention with every baseline feature, so an absent row is always a
// deliberate deletion — but the surveyor still gets told what the service will
// treat as removed. Oversubscription (children totalling more than their
// parent) is an ERROR: it means duplicated or mis-stamped rows.

import { HABITAT_TYPES } from './staged-layer-names.js'
import {
  AREA_SUM_TOLERANCE_SQ_M,
  OUTSIDE_BOUNDARY_TOLERANCE_M
} from '../postgis/constants.js'

/**
 * The dimension a habitat type's sizes are quoted in. Also decides how lineage
 * and containment measure an overlap, so a type cannot be reconciled on one
 * measure while its parentage is apportioned on another.
 */
export const MEASURE = Object.freeze({
  AREA: 'area',
  LENGTH: 'length',
  COUNT: 'count'
})

/** How a habitat type's baseline sizes must be accounted for — see module comment. */
export const SIZE_RULES = Object.freeze({
  /** Totals must balance exactly (within tolerance); shortfall is an error. */
  EXACT: 'exact',
  /** Per parent, children may total less (removal) but never more (error). */
  SHORTFALL: 'shortfall',
  /** A parent continues if it has any stamped child; childless = removed. */
  PRESENCE: 'presence'
})

/** A tree point without a Count column records a single tree. */
const DEFAULT_TREE_COUNT = 1
/** Counts are integers; any per-parent count drift is real. */
const COUNT_TOLERANCE = 0

/**
 * Per-type reconciliation policy.
 *
 * `sizeRule`       one of SIZE_RULES — how baseline size must be accounted for
 * `piWithinParent` every derived PI feature must lie inside its parent
 * `measure`        which dimension the sizes are in
 */
export const RECONCILIATION_POLICY = Object.freeze({
  [HABITAT_TYPES.AREAS]: {
    sizeRule: SIZE_RULES.EXACT,
    piWithinParent: true,
    measure: MEASURE.AREA,
    tolerance: AREA_SUM_TOLERANCE_SQ_M
  },
  [HABITAT_TYPES.VERTICAL_AREAS]: {
    sizeRule: SIZE_RULES.SHORTFALL,
    piWithinParent: true,
    measure: MEASURE.LENGTH,
    tolerance: OUTSIDE_BOUNDARY_TOLERANCE_M,
    reason: 'a demolished wall has no successor; absence records the loss'
  },
  [HABITAT_TYPES.HEDGEROWS]: {
    sizeRule: SIZE_RULES.SHORTFALL,
    piWithinParent: true,
    measure: MEASURE.LENGTH,
    tolerance: OUTSIDE_BOUNDARY_TOLERANCE_M,
    reason: 'lost length is the residual, as in the Statutory Metric sheets'
  },
  [HABITAT_TYPES.WATERCOURSES]: {
    sizeRule: SIZE_RULES.PRESENCE,
    piWithinParent: false,
    measure: MEASURE.LENGTH,
    tolerance: OUTSIDE_BOUNDARY_TOLERANCE_M,
    reason: 'realignment legitimately moves and lengthens the channel'
  },
  [HABITAT_TYPES.TREES]: {
    sizeRule: SIZE_RULES.SHORTFALL,
    piWithinParent: false,
    measure: MEASURE.COUNT,
    tolerance: COUNT_TOLERANCE,
    reason: 'a felled tree is an absent point'
  }
})

const SIZE_SQL = /* sql */ `
SELECT
  COALESCE(SUM(CASE WHEN stage = 'baseline' THEN size ELSE 0 END), 0) AS baseline_total,
  COALESCE(SUM(CASE WHEN stage = 'pi'       THEN size ELSE 0 END), 0) AS pi_total
FROM (
  SELECT stage,
         CASE WHEN $4::text = 'area'
              THEN ST_Area(ST_MakeValid(ST_GeomFromGeoJSON(geom)))
              ELSE ST_Length(ST_GeomFromGeoJSON(geom))
         END AS size
  FROM unnest($1::text[], $2::text[]) AS t(stage, geom)
  WHERE $3::boolean
) sized
`

/** Per-feature sizes, in input order. $1 geom[], $2 measure. */
const FEATURE_SIZES_SQL = /* sql */ `
SELECT ordinality - 1 AS idx,
       CASE WHEN $2::text = 'area'
            THEN ST_Area(ST_MakeValid(ST_GeomFromGeoJSON(geom)))
            ELSE ST_Length(ST_GeomFromGeoJSON(geom))
       END AS size
FROM unnest($1::text[]) WITH ORDINALITY AS t(geom, ordinality)
ORDER BY idx
`

/**
 * Size of each feature in the policy's measure, aligned with the input array.
 * Counts come off the feature row; areas and lengths come from PostGIS so this
 * module can never disagree with containment about a geometry's size.
 *
 * @param {import('pg').Pool} pool
 * @param {string} measure one of MEASURE
 * @param {object[]} features
 * @returns {Promise<number[]>}
 */
async function measureSizes(pool, measure, features) {
  if (measure === MEASURE.COUNT) {
    return features.map((feature) =>
      Number(feature?.properties?.Count ?? DEFAULT_TREE_COUNT)
    )
  }
  if (features.length === 0) {
    return []
  }
  const geoms = features.map((feature) =>
    JSON.stringify(feature?.geometry ?? null)
  )
  const { rows } = await pool.query(FEATURE_SIZES_SQL, [geoms, measure])
  return rows.map((row) => Number(row.size))
}

/**
 * Sum sizes into a map keyed by the given ref, skipping features without one.
 *
 * @param {object[]} features
 * @param {number[]} sizes aligned with features
 * @param {(feature: object) => string | null} refOf
 * @returns {Map<string, number>}
 */
function sumByRef(features, sizes, refOf) {
  const totals = new Map()
  features.forEach((feature, index) => {
    const ref = refOf(feature)
    if (ref == null || ref === '') {
      return
    }
    totals.set(ref, (totals.get(ref) ?? 0) + sizes[index])
  })
  return totals
}

/**
 * Compare total baseline size against total post-intervention size for one
 * habitat type. Only the EXACT rule (area habitats) is checked here; the
 * per-parent rules live in reconcileParents.
 *
 * @param {import('pg').Pool} pool
 * @param {string} type one of HABITAT_TYPES
 * @param {object[]} baseline features with { geometry }
 * @param {object[]} postIntervention features with { geometry }
 * @returns {Promise<{ type: string, checked: boolean, baselineTotal?: number, piTotal?: number, delta?: number, withinTolerance?: boolean, reason?: string }>}
 */
export async function reconcileSize(
  pool,
  type,
  baseline = [],
  postIntervention = []
) {
  const policy = RECONCILIATION_POLICY[type]
  if (!policy) {
    return { type, checked: false, reason: 'unknown habitat type' }
  }
  if (policy.sizeRule !== SIZE_RULES.EXACT) {
    return { type, checked: false, reason: policy.reason }
  }
  if (postIntervention.length === 0) {
    return { type, checked: false, reason: 'no post-intervention features' }
  }

  const stages = [
    ...baseline.map(() => 'baseline'),
    ...postIntervention.map(() => 'pi')
  ]
  const geoms = [...baseline, ...postIntervention].map((feature) =>
    JSON.stringify(feature?.geometry ?? null)
  )
  const { rows } = await pool.query(SIZE_SQL, [
    stages,
    geoms,
    true,
    policy.measure
  ])
  const baselineTotal = Number(rows[0].baseline_total)
  const piTotal = Number(rows[0].pi_total)
  const delta = baselineTotal - piTotal
  return {
    type,
    checked: true,
    measure: policy.measure,
    baselineTotal,
    piTotal,
    delta,
    withinTolerance: Math.abs(delta) <= policy.tolerance
  }
}

/**
 * Per-parent accounting for the SHORTFALL and PRESENCE rules.
 *
 * Children are grouped by their STAMPED parent ref only — geometry-derived
 * parentage is derived by overlap, so using it here would let a mis-drawn
 * child silently vouch for a parent it was never meant to continue.
 *
 * @param {import('pg').Pool} pool
 * @param {string} type one of HABITAT_TYPES
 * @param {object[]} baseline
 * @param {object[]} postIntervention
 * @returns {Promise<{ checked: boolean, reason?: string, removed: Array<{ type: string, parent_ref: string, measure: string, baseline_size: number, pi_size: number, removed_size: number }>, oversubscribed: Array<{ type: string, parent_ref: string, measure: string, baseline_size: number, pi_size: number, excess: number }> }>}
 */
export async function reconcileParents(
  pool,
  type,
  baseline = [],
  postIntervention = []
) {
  const none = { checked: false, removed: [], oversubscribed: [] }
  const policy = RECONCILIATION_POLICY[type]
  if (!policy) {
    return { ...none, reason: 'unknown habitat type' }
  }
  if (policy.sizeRule === SIZE_RULES.EXACT) {
    return { ...none, reason: 'totals are reconciled exactly for this type' }
  }
  if (baseline.length === 0) {
    return { ...none, reason: 'no baseline features' }
  }

  const baselineSizes = await measureSizes(pool, policy.measure, baseline)
  const piSizes = await measureSizes(pool, policy.measure, postIntervention)
  const parentTotals = sumByRef(baseline, baselineSizes, (f) => f?.ref ?? null)
  const childTotals = sumByRef(
    postIntervention,
    piSizes,
    (f) => f?.parentRef ?? null
  )

  const removed = []
  const oversubscribed = []
  for (const [parentRef, baselineSize] of parentTotals) {
    const piSize = childTotals.get(parentRef) ?? 0
    const shortfall = baselineSize - piSize
    const childless = !childTotals.has(parentRef)
    const sample = {
      type,
      parent_ref: parentRef,
      measure: policy.measure,
      baseline_size: baselineSize,
      pi_size: piSize
    }
    if (policy.sizeRule === SIZE_RULES.PRESENCE) {
      if (childless) {
        removed.push({ ...sample, removed_size: baselineSize })
      }
      continue
    }
    if (shortfall > policy.tolerance) {
      removed.push({ ...sample, removed_size: shortfall })
    } else if (shortfall < -policy.tolerance) {
      oversubscribed.push({ ...sample, excess: -shortfall })
    }
  }
  return { checked: true, removed, oversubscribed }
}

/**
 * True when this habitat type's post-intervention features must lie inside
 * their stamped parents.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function requiresContainment(type) {
  return RECONCILIATION_POLICY[type]?.piWithinParent === true
}

/**
 * True when this habitat type is measured in metres of length rather than
 * square metres of area — hedgerows, watercourses, and vertical area habitats,
 * whose footprint is a line even though the recorded size is a wall face.
 *
 * Read from the same policy table as everything else so lineage, containment
 * and reconciliation can never disagree about a type's dimension.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function isLinearMeasure(type) {
  return RECONCILIATION_POLICY[type]?.measure === MEASURE.LENGTH
}

/**
 * The dimension a habitat type's sizes are quoted in, for error messages.
 *
 * @param {string} type
 * @returns {string | undefined}
 */
export function measureFor(type) {
  return RECONCILIATION_POLICY[type]?.measure
}
