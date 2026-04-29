import { ERROR_CODES, featureRef, makeError } from '../../errors.js'

/**
 * Find features in a layer whose geometry is not OGC-valid (covers self-
 * intersection and other ring-level errors).
 */
async function findInvalidFeatures(pool, runId, layer) {
  const { rows } = await pool.query(
    `SELECT feature_idx, props
     FROM bng.baseline_validation_geom
     WHERE run_id = $1 AND layer = $2 AND NOT ST_IsValid(geom)
     ORDER BY feature_idx`,
    [runId, layer]
  )
  return rows
}

export async function redlineSelfIntersection(pool, runId) {
  const rows = await findInvalidFeatures(pool, runId, 'redline')
  if (rows.length === 0) {
    return null
  }
  return makeError(
    ERROR_CODES.REDLINE_SELF_INTERSECTING,
    'Redline boundary is self-intersecting'
  )
}

export async function areaParcelsSelfIntersection(pool, runId) {
  const rows = await findInvalidFeatures(pool, runId, 'areas')
  if (rows.length === 0) {
    return null
  }
  const offending = rows.map((r) =>
    featureRef({ properties: r.props ?? {} }, r.feature_idx)
  )
  return makeError(
    ERROR_CODES.AREA_PARCELS_SELF_INTERSECTING,
    'One or more area habitat polygons are self-intersecting',
    offending
  )
}
