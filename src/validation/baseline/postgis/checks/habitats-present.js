import { ERROR_CODES, makeError } from '../../errors.js'

export async function habitatsPresent(pool, runId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM bng.baseline_validation_geom
     WHERE run_id = $1 AND layer = 'areas'`,
    [runId]
  )
  if ((rows[0]?.n ?? 0) > 0) {
    return null
  }
  return makeError(
    ERROR_CODES.NO_HABITAT_AREAS,
    'Baseline file contains no area habitat polygons'
  )
}
