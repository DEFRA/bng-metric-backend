import { ERROR_CODES, makeError } from '../../errors.js'

const DEFAULT_TOLERANCE_SQ_METRES = 0.5

/**
 * Compare the total redline area to the total area-habitat area, both in
 * EPSG:27700 metres (planar). Geometries are stored in 27700 by the loader, so
 * ST_Area(geom) is already in square metres.
 */
export async function areaSum(
  pool,
  runId,
  tolerance = DEFAULT_TOLERANCE_SQ_METRES
) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN layer = 'redline' THEN ST_Area(geom) END), 0) AS redline_total,
       COALESCE(SUM(CASE WHEN layer = 'areas'   THEN ST_Area(geom) END), 0) AS habitats_total,
       COUNT(*) FILTER (WHERE layer = 'redline') AS redline_count,
       COUNT(*) FILTER (WHERE layer = 'areas')   AS habitats_count
     FROM bng.baseline_validation_geom
     WHERE run_id = $1`,
    [runId]
  )
  const row = rows[0]
  if (
    !row ||
    Number(row.redline_count) === 0 ||
    Number(row.habitats_count) === 0
  ) {
    return null
  }
  const redlineTotal = Number(row.redline_total)
  const habitatsTotal = Number(row.habitats_total)
  if (Math.abs(redlineTotal - habitatsTotal) <= tolerance) {
    return null
  }
  return makeError(
    ERROR_CODES.AREA_SUM_MISMATCH,
    `Sum of area habitat polygons (${habitatsTotal.toFixed(2)} sq m) does not equal redline boundary area (${redlineTotal.toFixed(2)} sq m)`
  )
}
