import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ERROR_CODES, makeError } from '../../errors.js'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const englandPath = path.join(
  moduleDir,
  '..',
  '..',
  'reference',
  'england.geojson'
)
const englandGeoJson = JSON.parse(fs.readFileSync(englandPath, 'utf8'))
// Reference polygon ships as a Feature in EPSG:4326; PostGIS will reproject
// to the staging SRID at query time.
const englandGeometryJson = JSON.stringify(englandGeoJson.geometry)

export async function redlineInEngland(pool, runId) {
  const { rows } = await pool.query(
    `WITH england AS (
       SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 27700) AS geom
     )
     SELECT 1
     FROM bng.baseline_validation_geom f
     CROSS JOIN england e
     WHERE f.run_id = $1 AND f.layer = 'redline'
       AND NOT ST_Within(f.geom, e.geom)
     LIMIT 1`,
    [runId, englandGeometryJson]
  )
  if (rows.length === 0) {
    return null
  }
  return makeError(
    ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
    'Redline boundary is outside England'
  )
}
