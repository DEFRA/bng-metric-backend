// Enforce the "post-intervention feature lies inside its baseline parent" half
// of the reconciliation policy. `requiresContainment()` decides which habitat
// types this applies to; this module is what acts on the answer.
//
// Measured as the SIZE OF ST_Difference, never as a Boolean predicate. Two
// reasons, both learned the hard way elsewhere in this codebase:
//
//   * A PI parcel cut from its parent shares that parent's edges exactly. A
//     vertex one ULP outside the shared edge makes ST_Within false while the
//     geometric distance is zero, so a predicate rejects ordinary correct work.
//   * The size of the escaping piece is the thing the surveyor needs told —
//     "3.2 sq m outside PR-1" is actionable, "not within" is not.
//
// The tolerances are the same ones the redline checks use (postgis/constants.js)
// because the situation is the same: a feature sharing an edge with the polygon
// it is being tested against.
//
// Only features with a STAMPED parent are tested. A parent derived from
// geometry is derived *by* overlap, so testing it for overlap proves nothing;
// worse, the pond in the fixture legitimately straddles two parcels and would
// fail containment against either one of them alone.

import {
  OUTSIDE_BOUNDARY_TOLERANCE_M,
  OVERLAY_GRID_SIZE_M,
  PARCEL_OUTSIDE_TOLERANCE_SQ_M
} from '../postgis/constants.js'
import {
  isLinearMeasure,
  measureFor,
  requiresContainment
} from './reconcile.js'

/** Lineage entries this check applies to — see the module comment. */
const STAMPED = 'stamped'

/**
 * Parents are unioned by ref before the difference is taken. A ref carried by
 * more than one baseline row is one parent drawn in several pieces, and
 * differencing against only the first piece would report the others as escapes.
 *
 * $1 pi index[], $2 pi ref[], $3 stamped parent ref[], $4 pi geom[],
 * $5 baseline ref[], $6 baseline geom[], $7 tolerance
 */
const AREA_CONTAINMENT_SQL = /* sql */ `
WITH parents AS (
  SELECT ref, ST_Union(ST_MakeValid(ST_GeomFromGeoJSON(geom))) AS geom
  FROM unnest($5::text[], $6::text[]) AS t(ref, geom)
  GROUP BY ref
),
pi AS (
  SELECT idx, ref, parent_ref, ST_MakeValid(ST_GeomFromGeoJSON(geom)) AS geom
  FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])
    AS t(idx, ref, parent_ref, geom)
)
SELECT idx, pi_ref, parent_ref, escape_size
FROM (
  SELECT pi.idx,
         pi.ref        AS pi_ref,
         pi.parent_ref AS parent_ref,
         ST_Area(ST_Difference(pi.geom, parents.geom, ${OVERLAY_GRID_SIZE_M})) AS escape_size
  FROM pi JOIN parents ON parents.ref = pi.parent_ref
) measured
WHERE escape_size > $7
ORDER BY idx
`

/** The linear equivalent: length of the line lying off its parent line. */
const LINEAR_CONTAINMENT_SQL = /* sql */ `
WITH parents AS (
  SELECT ref, ST_Union(ST_GeomFromGeoJSON(geom)) AS geom
  FROM unnest($5::text[], $6::text[]) AS t(ref, geom)
  GROUP BY ref
),
pi AS (
  SELECT idx, ref, parent_ref, ST_GeomFromGeoJSON(geom) AS geom
  FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])
    AS t(idx, ref, parent_ref, geom)
)
SELECT idx, pi_ref, parent_ref, escape_size
FROM (
  SELECT pi.idx,
         pi.ref        AS pi_ref,
         pi.parent_ref AS parent_ref,
         ST_Length(ST_Difference(pi.geom, parents.geom, ${OVERLAY_GRID_SIZE_M})) AS escape_size
  FROM pi JOIN parents ON parents.ref = pi.parent_ref
) measured
WHERE escape_size > $7
ORDER BY idx
`

/**
 * The post-intervention features whose parent came from a stamp rather than
 * from geometry, paired with the ref they were stamped with.
 *
 * @param {object[]} postIntervention
 * @param {object[]} lineage output of deriveLineage, aligned by piIndex
 * @returns {Array<{ feature: object, piIndex: number, parentRef: string }>}
 */
function stampedFeatures(postIntervention, lineage) {
  const stamped = []
  for (const entry of lineage) {
    if (entry?.source !== STAMPED) {
      continue
    }
    const feature = postIntervention[entry.piIndex]
    const parentRef = entry.parents[0]?.ref
    if (feature && parentRef) {
      stamped.push({ feature, piIndex: entry.piIndex, parentRef })
    }
  }
  return stamped
}

/**
 * Check that every stamped post-intervention feature of one habitat type lies
 * inside the baseline feature it names.
 *
 * Returns offenders in the `details.sample` shape the staged error builders
 * expect; an empty array means the type passed (or is exempt).
 *
 * @param {import('pg').Pool} pool
 * @param {string} type one of HABITAT_TYPES
 * @param {{ postIntervention: object[], baseline: object[], lineage: object[] }} args
 * @returns {Promise<Array<{ type: string, pi_ref: string|null, parent_ref: string, escape_size: number, measure: string }>>}
 */
export async function checkContainment(
  pool,
  type,
  { postIntervention = [], baseline = [], lineage = [] }
) {
  if (!requiresContainment(type)) {
    return []
  }
  const stamped = stampedFeatures(postIntervention, lineage)
  if (stamped.length === 0 || baseline.length === 0) {
    return []
  }

  const linear = isLinearMeasure(type)
  const { rows } = await pool.query(
    linear ? LINEAR_CONTAINMENT_SQL : AREA_CONTAINMENT_SQL,
    [
      stamped.map((entry) => entry.piIndex),
      stamped.map((entry) => entry.feature.piRef ?? null),
      stamped.map((entry) => entry.parentRef),
      stamped.map((entry) => JSON.stringify(entry.feature.geometry ?? null)),
      baseline.map((feature) => feature?.ref ?? null),
      baseline.map((feature) => JSON.stringify(feature?.geometry ?? null)),
      linear ? OUTSIDE_BOUNDARY_TOLERANCE_M : PARCEL_OUTSIDE_TOLERANCE_SQ_M
    ]
  )

  const measure = measureFor(type)
  return rows.map((row) => ({
    type,
    pi_ref: row.pi_ref,
    parent_ref: row.parent_ref,
    escape_size: Number(row.escape_size),
    measure
  }))
}
