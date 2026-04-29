import { ERROR_CODES, featureRef, makeError } from '../../errors.js'

const OVERLAP_AREA_TOLERANCE_SQ_METRES = 0.5

/**
 * Find any pair of area-habitat parcels whose intersection has a non-trivial
 * area (above tolerance). PostGIS spatial index makes this affordable without
 * the explicit O(n^2) loop the Turf path uses.
 */
export async function parcelOverlaps(
  pool,
  runId,
  tolerance = OVERLAP_AREA_TOLERANCE_SQ_METRES
) {
  const { rows } = await pool.query(
    `WITH parcels AS (
       SELECT feature_idx, props, geom
       FROM bng.baseline_validation_geom
       WHERE run_id = $1 AND layer = 'areas'
     ),
     pairs AS (
       SELECT a.feature_idx AS a_idx, a.props AS a_props,
              b.feature_idx AS b_idx, b.props AS b_props,
              ST_Area(ST_Intersection(a.geom, b.geom)) AS overlap_area
       FROM parcels a
       JOIN parcels b
         ON a.feature_idx < b.feature_idx
        AND ST_Intersects(a.geom, b.geom)
     )
     SELECT DISTINCT idx, props
     FROM (
       SELECT a_idx AS idx, a_props AS props FROM pairs WHERE overlap_area > $2
       UNION
       SELECT b_idx AS idx, b_props AS props FROM pairs WHERE overlap_area > $2
     ) o
     ORDER BY idx`,
    [runId, tolerance]
  )

  if (rows.length === 0) {
    return null
  }
  const offending = rows.map((r) =>
    featureRef({ properties: r.props ?? {} }, r.idx)
  )
  return makeError(
    ERROR_CODES.PARCEL_OVERLAPS,
    'One or more area habitat parcels overlap with other parcels',
    offending
  )
}
