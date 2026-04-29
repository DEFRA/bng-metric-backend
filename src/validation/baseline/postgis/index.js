import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ERROR_CODES, featureRef, makeError } from '../errors.js'

// Single-statement validation: the layer features are passed in as parallel
// arrays of GeoJSON strings, parsed and reprojected to EPSG:27700 inside the
// query, used for every spatial check, and discarded when the statement
// finishes. Nothing is persisted server-side.

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const englandGeoJson = JSON.parse(
  fs.readFileSync(
    path.join(moduleDir, '..', 'reference', 'england.geojson'),
    'utf8'
  )
)
const ENGLAND_GEOMETRY_JSON = JSON.stringify(englandGeoJson.geometry)

const LAYER_NAMES = [
  'redline',
  'areas',
  'hedgerows',
  'watercourses',
  'iggis',
  'trees'
]

const SLIVER_THRESHOLD_SQ_M = 1
const OVERLAP_TOLERANCE_SQ_M = 0.5
const AREA_SUM_TOLERANCE_SQ_M = 0.5
const MAX_REDLINE_AREA_SQ_M = 100 * 1000 * 1000

// Fallback when an upstream feature carries no nativeSrid. WGS84 is what the
// GeoJSON spec assumes, so it's the right default for unmarked geometries.
const DEFAULT_SRID = 4326

// Order matches the Turf-engine sequence so error output is stable across
// engines.
const ERROR_ORDER = [
  ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
  ERROR_CODES.REDLINE_AREA_TOO_LARGE,
  ERROR_CODES.NO_HABITAT_AREAS,
  ERROR_CODES.REDLINE_SELF_INTERSECTING,
  ERROR_CODES.AREA_PARCELS_SELF_INTERSECTING,
  ERROR_CODES.PARCEL_OVERLAPS,
  ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
  ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
  ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
  ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
  ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
  ERROR_CODES.TREES_OUTSIDE_REDLINE,
  ERROR_CODES.AREA_SUM_MISMATCH
]

const offendingFromPayload = (payload) =>
  (payload?.offending ?? []).map((o) =>
    featureRef({ properties: o.props ?? {} }, o.idx)
  )

const ERROR_BUILDERS = {
  [ERROR_CODES.REDLINE_OUTSIDE_ENGLAND]: () =>
    makeError(
      ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
      'Redline boundary is outside England'
    ),
  [ERROR_CODES.REDLINE_AREA_TOO_LARGE]: (p) =>
    makeError(
      ERROR_CODES.REDLINE_AREA_TOO_LARGE,
      `Redline boundary area (${Number(p.total).toFixed(0)} sq m) exceeds the 100 sq km limit`
    ),
  [ERROR_CODES.NO_HABITAT_AREAS]: () =>
    makeError(
      ERROR_CODES.NO_HABITAT_AREAS,
      'Baseline file contains no area habitat polygons'
    ),
  [ERROR_CODES.REDLINE_SELF_INTERSECTING]: () =>
    makeError(
      ERROR_CODES.REDLINE_SELF_INTERSECTING,
      'Redline boundary is self-intersecting'
    ),
  [ERROR_CODES.AREA_PARCELS_SELF_INTERSECTING]: (p) =>
    makeError(
      ERROR_CODES.AREA_PARCELS_SELF_INTERSECTING,
      'One or more area habitat polygons are self-intersecting',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.PARCEL_OVERLAPS]: (p) =>
    makeError(
      ERROR_CODES.PARCEL_OVERLAPS,
      'One or more area habitat parcels overlap with other parcels',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.SLIVERS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
      'Baseline file contains slivers between area habitat polygons and the redline boundary',
      (p?.slivers ?? []).map((s) => ({
        id: Number(s.id),
        area: Number(Number(s.area).toFixed(4))
      }))
    ),
  [ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
      'One or more area habitat polygons are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
      'One or more hedgerow habitats are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
      'One or more watercourse habitats are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.IGGIS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
      'One or more IGGIs are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.TREES_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.TREES_OUTSIDE_REDLINE,
      'One or more trees are not entirely within the redline boundary',
      offendingFromPayload(p)
    ),
  [ERROR_CODES.AREA_SUM_MISMATCH]: (p) =>
    makeError(
      ERROR_CODES.AREA_SUM_MISMATCH,
      `Sum of area habitat polygons (${Number(p.habitats_total).toFixed(2)} sq m) does not equal redline boundary area (${Number(p.redline_total).toFixed(2)} sq m)`
    )
}

const CHECK_QUERY = `
WITH features_in AS (
  SELECT layer, idx, props::jsonb AS props,
         ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), 27700) AS geom
  FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::int[])
    AS t(layer, idx, props, g, srid)
),
redline AS (SELECT idx, props, geom FROM features_in WHERE layer = 'redline'),
areas AS (SELECT idx, props, geom FROM features_in WHERE layer = 'areas'),
hedgerows AS (SELECT idx, props, geom FROM features_in WHERE layer = 'hedgerows'),
watercourses AS (SELECT idx, props, geom FROM features_in WHERE layer = 'watercourses'),
iggis AS (SELECT idx, props, geom FROM features_in WHERE layer = 'iggis'),
trees AS (SELECT idx, props, geom FROM features_in WHERE layer = 'trees'),
redline_union AS (SELECT ST_Union(ST_MakeValid(geom)) AS geom FROM redline),
parcels_union AS (SELECT ST_Union(ST_MakeValid(geom)) AS geom FROM areas),
england AS (
  SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), 27700) AS geom
),
c_redline_total AS (
  SELECT COALESCE(SUM(ST_Area(geom)), 0) AS total, COUNT(*) AS n FROM redline
),
c_habitats_total AS (
  SELECT COALESCE(SUM(ST_Area(geom)), 0) AS total, COUNT(*) AS n FROM areas
),
c_redline_outside_england AS (
  SELECT 1 AS hit
  FROM redline f, england e
  WHERE NOT ST_Within(ST_MakeValid(f.geom), e.geom)
  LIMIT 1
),
c_redline_invalid AS (
  SELECT 1 AS hit FROM redline WHERE NOT ST_IsValid(geom) LIMIT 1
),
c_areas_invalid AS (
  SELECT idx, props FROM areas WHERE NOT ST_IsValid(geom)
),
c_overlap_pairs AS (
  SELECT a.idx AS a_idx, a.props AS a_props,
         b.idx AS b_idx, b.props AS b_props,
         ST_Area(ST_Intersection(ST_MakeValid(a.geom), ST_MakeValid(b.geom))) AS overlap_area
  FROM areas a JOIN areas b
    ON a.idx < b.idx AND ST_Intersects(a.geom, b.geom)
),
c_overlap_offending AS (
  SELECT DISTINCT idx, props FROM (
    SELECT a_idx AS idx, a_props AS props FROM c_overlap_pairs WHERE overlap_area > $8
    UNION
    SELECT b_idx AS idx, b_props AS props FROM c_overlap_pairs WHERE overlap_area > $8
  ) o
),
c_slivers AS (
  SELECT row_number() OVER (ORDER BY ST_Area(g)) - 1 AS id, ST_Area(g) AS area
  FROM (
    SELECT (ST_Dump(ST_Difference(r.geom, p.geom))).geom AS g
    FROM redline_union r CROSS JOIN parcels_union p
    WHERE r.geom IS NOT NULL AND p.geom IS NOT NULL
  ) leftover
  WHERE ST_Area(g) < $7
),
c_areas_outside AS (
  SELECT f.idx, f.props FROM areas f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(ST_MakeValid(f.geom), r.geom)
),
c_hedgerows_outside AS (
  SELECT f.idx, f.props FROM hedgerows f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(ST_MakeValid(f.geom), r.geom)
),
c_watercourses_outside AS (
  SELECT f.idx, f.props FROM watercourses f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(ST_MakeValid(f.geom), r.geom)
),
c_iggis_outside AS (
  SELECT f.idx, f.props FROM iggis f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(ST_MakeValid(f.geom), r.geom)
),
c_trees_outside AS (
  SELECT f.idx, f.props FROM trees f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(ST_MakeValid(f.geom), r.geom)
)
SELECT 'REDLINE_OUTSIDE_ENGLAND' AS code, '{}'::jsonb AS payload
FROM c_redline_outside_england
UNION ALL
SELECT 'REDLINE_AREA_TOO_LARGE', jsonb_build_object('total', total)
FROM c_redline_total WHERE total > $10
UNION ALL
SELECT 'NO_HABITAT_AREAS', '{}'::jsonb
FROM c_habitats_total WHERE n = 0
UNION ALL
SELECT 'REDLINE_SELF_INTERSECTING', '{}'::jsonb
FROM c_redline_invalid
UNION ALL
SELECT 'AREA_PARCELS_SELF_INTERSECTING',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object('idx', idx, 'props', props) ORDER BY idx))
FROM c_areas_invalid HAVING count(*) > 0
UNION ALL
SELECT 'PARCEL_OVERLAPS',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object('idx', idx, 'props', props) ORDER BY idx))
FROM c_overlap_offending HAVING count(*) > 0
UNION ALL
SELECT 'SLIVERS_OUTSIDE_REDLINE',
       jsonb_build_object('slivers',
         jsonb_agg(jsonb_build_object('id', id, 'area', area) ORDER BY area))
FROM c_slivers HAVING count(*) > 0
UNION ALL
SELECT 'AREA_PARCELS_OUTSIDE_REDLINE',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object('idx', idx, 'props', props) ORDER BY idx))
FROM c_areas_outside HAVING count(*) > 0
UNION ALL
SELECT 'HEDGEROWS_OUTSIDE_REDLINE',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object('idx', idx, 'props', props) ORDER BY idx))
FROM c_hedgerows_outside HAVING count(*) > 0
UNION ALL
SELECT 'WATERCOURSES_OUTSIDE_REDLINE',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object('idx', idx, 'props', props) ORDER BY idx))
FROM c_watercourses_outside HAVING count(*) > 0
UNION ALL
SELECT 'IGGIS_OUTSIDE_REDLINE',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object('idx', idx, 'props', props) ORDER BY idx))
FROM c_iggis_outside HAVING count(*) > 0
UNION ALL
SELECT 'TREES_OUTSIDE_REDLINE',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object('idx', idx, 'props', props) ORDER BY idx))
FROM c_trees_outside HAVING count(*) > 0
UNION ALL
SELECT 'AREA_SUM_MISMATCH',
       jsonb_build_object('redline_total', rt.total, 'habitats_total', ht.total)
FROM c_redline_total rt CROSS JOIN c_habitats_total ht
WHERE rt.n > 0 AND ht.n > 0 AND abs(rt.total - ht.total) > $9
`

function buildArrays(layers) {
  const layerNames = []
  const idxs = []
  const props = []
  const geoms = []
  const srids = []
  for (const layerName of LAYER_NAMES) {
    const features = layers[layerName] ?? []
    features.forEach((feature, index) => {
      const geom = feature.nativeGeometry ?? feature.geometry
      if (!geom) {
        return
      }
      layerNames.push(layerName)
      idxs.push(index)
      props.push(JSON.stringify(feature.properties ?? {}))
      geoms.push(JSON.stringify(geom))
      srids.push(feature.nativeSrid ?? DEFAULT_SRID)
    })
  }
  return { layerNames, idxs, props, geoms, srids }
}

/**
 * Run every baseline geometry check in a single PostGIS statement. No data is
 * persisted: features are passed in as parameters, parsed in-query, used for
 * the spatial checks, and discarded.
 *
 * @param {import('pg').Pool} pool
 * @param {object} layers Output of readBaselineGeoPackage
 */
export async function validateBaselineLayersPostgis(pool, layers) {
  const { layerNames, idxs, props, geoms, srids } = buildArrays(layers)

  const { rows } = await pool.query(CHECK_QUERY, [
    layerNames,
    idxs,
    props,
    geoms,
    srids,
    ENGLAND_GEOMETRY_JSON,
    SLIVER_THRESHOLD_SQ_M,
    OVERLAP_TOLERANCE_SQ_M,
    AREA_SUM_TOLERANCE_SQ_M,
    MAX_REDLINE_AREA_SQ_M
  ])

  const byCode = new Map()
  for (const row of rows) {
    const builder = ERROR_BUILDERS[row.code]
    if (builder) {
      byCode.set(row.code, builder(row.payload ?? {}))
    }
  }

  const errors = ERROR_ORDER.filter((c) => byCode.has(c)).map((c) =>
    byCode.get(c)
  )

  return { valid: errors.length === 0, errors }
}
