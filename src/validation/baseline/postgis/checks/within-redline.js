import { ERROR_CODES, featureRef, makeError } from '../../errors.js'

const SPECS = {
  areas: {
    code: ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
    message:
      'One or more area habitat polygons are not entirely within the redline boundary'
  },
  hedgerows: {
    code: ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
    message:
      'One or more hedgerow habitats are not entirely within the redline boundary'
  },
  watercourses: {
    code: ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
    message:
      'One or more watercourse habitats are not entirely within the redline boundary'
  },
  iggis: {
    code: ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
    message: 'One or more IGGIs are not entirely within the redline boundary'
  },
  trees: {
    code: ERROR_CODES.TREES_OUTSIDE_REDLINE,
    message: 'One or more trees are not entirely within the redline boundary'
  }
}

/**
 * Find features in `layerName` that are not contained by the union of the
 * redline polygons.
 */
export async function withinRedline(pool, runId, layerName) {
  const spec = SPECS[layerName]
  if (!spec) {
    throw new Error(`Unknown layer: ${layerName}`)
  }

  const { rows } = await pool.query(
    `WITH redline AS (
       SELECT ST_Union(geom) AS geom
       FROM bng.baseline_validation_geom
       WHERE run_id = $1 AND layer = 'redline'
     )
     SELECT f.feature_idx, f.props
     FROM bng.baseline_validation_geom f
     CROSS JOIN redline r
     WHERE f.run_id = $1 AND f.layer = $2
       AND r.geom IS NOT NULL
       AND NOT ST_Within(f.geom, r.geom)
     ORDER BY f.feature_idx`,
    [runId, layerName]
  )

  if (rows.length === 0) {
    return null
  }
  const offending = rows.map((r) =>
    featureRef({ properties: r.props ?? {} }, r.feature_idx)
  )
  return makeError(spec.code, spec.message, offending)
}
