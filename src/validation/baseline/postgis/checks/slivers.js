import { ERROR_CODES, makeError } from '../../errors.js'

const DEFAULT_SLIVER_THRESHOLD_SQ_METRES = 1

/**
 * A sliver is a small leftover of redline-bounded area that no parcel covers.
 * In SQL: difference between the unioned redline and the unioned parcels,
 * dumped to individual polygons, filtered by area threshold.
 */
export async function slivers(
  pool,
  runId,
  threshold = DEFAULT_SLIVER_THRESHOLD_SQ_METRES
) {
  const { rows } = await pool.query(
    `WITH redline AS (
       SELECT ST_Union(geom) AS geom
       FROM bng.baseline_validation_geom
       WHERE run_id = $1 AND layer = 'redline'
     ),
     parcels AS (
       SELECT ST_Union(geom) AS geom
       FROM bng.baseline_validation_geom
       WHERE run_id = $1 AND layer = 'areas'
     ),
     leftover AS (
       SELECT (ST_Dump(ST_Difference(r.geom, p.geom))).geom AS geom
       FROM redline r CROSS JOIN parcels p
       WHERE r.geom IS NOT NULL AND p.geom IS NOT NULL
     )
     SELECT row_number() OVER (ORDER BY ST_Area(geom)) - 1 AS id,
            ST_Area(geom) AS area
     FROM leftover
     WHERE ST_Area(geom) < $2
     ORDER BY area`,
    [runId, threshold]
  )

  if (rows.length === 0) {
    return null
  }
  const sliverPolys = rows.map((r) => ({
    id: Number(r.id),
    area: Number(Number(r.area).toFixed(4))
  }))
  return makeError(
    ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
    'Baseline file contains slivers between area habitat polygons and the redline boundary',
    sliverPolys
  )
}
