import { ERROR_CODES, makeError } from '../../errors.js'

const MAX_AREA_SQ_METRES = 100 * 1000 * 1000 // 100 sq km

export async function redlineArea(pool, runId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(ST_Area(geom)), 0) AS total
     FROM bng.baseline_validation_geom
     WHERE run_id = $1 AND layer = 'redline'`,
    [runId]
  )
  const total = Number(rows[0]?.total ?? 0)
  if (total === 0 || total <= MAX_AREA_SQ_METRES) {
    return null
  }
  return makeError(
    ERROR_CODES.REDLINE_AREA_TOO_LARGE,
    `Redline boundary area (${total.toFixed(0)} sq m) exceeds the 100 sq km limit`
  )
}
