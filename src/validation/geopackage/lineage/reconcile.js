// Reconcile a staged GeoPackage's post-intervention layers against their
// baselines.
//
// The invariant is NOT uniform across habitat types, and applying one rule
// everywhere would reject legitimate work. Established by prototyping each type
// in QGIS:
//
//   Area habitats     total area equal, PI within baseline
//   Vertical areas    same (the recorded Area is the wall face, but the
//                     footprint still derives from the baseline line)
//   Hedgerows         total length equal, PI on the baseline. A hedge is
//                     removed or kept in place; it is not realigned.
//   Watercourses      NEITHER. Re-meandering a straightened channel moves it
//                     off the old line and makes it longer — a headline BNG
//                     intervention. Only red-line containment applies.
//   Trees             NEITHER. Points have no extent and no containment.
//
// `Lost` rows count towards the totals. They are the record that a piece of
// ground was accounted for; dropping them would make a fully developed site
// look like it had a coverage gap.

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

/**
 * Per-type reconciliation policy.
 *
 * `sizeMustMatch`  compare total baseline size against total PI size
 * `piWithinParent` every derived PI feature must lie inside its parent
 * `measure`        which dimension the totals are in
 */
export const RECONCILIATION_POLICY = Object.freeze({
  [HABITAT_TYPES.AREAS]: {
    sizeMustMatch: true,
    piWithinParent: true,
    measure: MEASURE.AREA,
    tolerance: AREA_SUM_TOLERANCE_SQ_M
  },
  [HABITAT_TYPES.VERTICAL_AREAS]: {
    sizeMustMatch: true,
    piWithinParent: true,
    measure: MEASURE.LENGTH,
    tolerance: OUTSIDE_BOUNDARY_TOLERANCE_M
  },
  [HABITAT_TYPES.HEDGEROWS]: {
    sizeMustMatch: true,
    piWithinParent: true,
    measure: MEASURE.LENGTH,
    tolerance: OUTSIDE_BOUNDARY_TOLERANCE_M
  },
  [HABITAT_TYPES.WATERCOURSES]: {
    sizeMustMatch: false,
    piWithinParent: false,
    measure: MEASURE.LENGTH,
    tolerance: OUTSIDE_BOUNDARY_TOLERANCE_M,
    reason: 'realignment legitimately moves and lengthens the channel'
  },
  [HABITAT_TYPES.TREES]: {
    sizeMustMatch: false,
    piWithinParent: false,
    measure: MEASURE.COUNT,
    reason: 'points have no extent'
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

/**
 * Compare total baseline size against total post-intervention size for one
 * habitat type.
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
  if (!policy.sizeMustMatch) {
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
