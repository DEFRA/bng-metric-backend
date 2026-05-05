import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ERROR_CODES } from '../errors.js'
import { ERROR_BUILDERS } from './error-builders.js'

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

// Baseline geometry validation, run as a single PostGIS statement. Features
// are passed in as parallel arrays of GeoJSON strings ($1..$5), parsed and
// reprojected to EPSG:27700 inside the query, used for every spatial check,
// and discarded when the statement finishes. Nothing is persisted.
//
// Parameters
//   $1  text[]   layer names per feature (redline | areas | hedgerows | watercourses | iggis | trees)
//   $2  int[]    feature index within its layer (preserves source ordering)
//   $3  text[]   feature properties as JSONB strings
//   $4  text[]   feature geometry as GeoJSON strings
//   $5  int[]    native SRID per feature (geometry reprojected to 27700)
//   $6  text     England reference polygon as GeoJSON (EPSG:4326)
//   $7  numeric  SLIVER_THRESHOLD_SQ_M           — slivers smaller than this are ignored as GEOS noise
//   $8  numeric  OVERLAP_TOLERANCE_SQ_M          — parcel-pair intersections smaller than this aren't overlaps
//   $9  numeric  AREA_SUM_TOLERANCE_SQ_M         — habitat-sum vs. redline-area mismatch tolerance
//   $10 numeric  MAX_REDLINE_AREA_SQ_M           — hard cap on redline area (100 sq km)
//   $11 numeric  OVERLAY_GRID_SIZE_M             — fixed-precision grid for ST_Difference / ST_Intersection
//   $12 numeric  PARCEL_OUTSIDE_TOLERANCE_SQ_M   — area-difference tolerance for "parcel outside redline"
//
// Output: one row per triggered error code, with `code` (text) and `payload`
// (jsonb). The NodeJS side maps each row through ERROR_BUILDERS and orders them
// via ERROR_ORDER.

// TIP: use the VS Code extension "bierner.comment-tagged-templates" to get SQL syntax
// highlighting after the /* sql */ comment.

const CHECK_QUERY = /* sql */ `
WITH
-- Reproject every input feature to EPSG:27700 (British National Grid). All
-- subsequent area / containment maths is in metres on this CRS.
features_in AS (
  SELECT layer, idx, props::jsonb AS props,
         ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), 27700) AS geom
  FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::int[])
    AS t(layer, idx, props, g, srid)
),
-- Per-layer views over features_in.
redline      AS (SELECT idx, props, geom FROM features_in WHERE layer = 'redline'),
areas        AS (SELECT idx, props, geom FROM features_in WHERE layer = 'areas'),
hedgerows    AS (SELECT idx, props, geom FROM features_in WHERE layer = 'hedgerows'),
watercourses AS (SELECT idx, props, geom FROM features_in WHERE layer = 'watercourses'),
iggis        AS (SELECT idx, props, geom FROM features_in WHERE layer = 'iggis'),
trees        AS (SELECT idx, props, geom FROM features_in WHERE layer = 'trees'),
-- Single dissolved geometry per layer used for containment / leftover checks.
-- ST_MakeValid first so we don't propagate self-intersection failures.
redline_union AS (SELECT ST_Union(ST_MakeValid(geom)) AS geom FROM redline),
parcels_union AS (SELECT ST_Union(ST_MakeValid(geom)) AS geom FROM areas),
-- England reference polygon, reprojected to match.
england AS (
  SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), 27700) AS geom
),

-- ---------------------------------------------------------------------------
-- Per-check CTEs. Each one resolves to either an empty rowset (check passes)
-- or one+ rows that the final UNION ALL converts into an error row.
-- ---------------------------------------------------------------------------

c_redline_total AS (
  SELECT COALESCE(SUM(ST_Area(geom)), 0) AS total, COUNT(*) AS n FROM redline
),
c_habitats_total AS (
  SELECT COALESCE(SUM(ST_Area(geom)), 0) AS total, COUNT(*) AS n FROM areas
),
-- Redline must lie wholly within England.
c_redline_outside_england AS (
  SELECT 1 AS hit
  FROM redline f, england e
  WHERE NOT ST_Within(f.geom, e.geom)
  LIMIT 1
),
-- Invalid redline geometry. ST_IsValid catches self-intersection, ring
-- orientation problems, duplicate rings, hole-outside-shell, etc.;
-- ST_IsValidDetail surfaces the specific reason + location so the error
-- message can name what's wrong.
c_redline_invalid AS (
  SELECT (ST_IsValidDetail(geom)).reason AS reason,
         ST_AsText((ST_IsValidDetail(geom)).location) AS location_wkt
  FROM redline
  WHERE NOT ST_IsValid(geom)
  LIMIT 1
),
-- Invalid habitat parcel geometry (one row per offending feature).
c_areas_invalid AS (
  SELECT idx, props,
         (ST_IsValidDetail(geom)).reason AS reason,
         ST_AsText((ST_IsValidDetail(geom)).location) AS location_wkt
  FROM areas WHERE NOT ST_IsValid(geom)
),
-- Pair-wise overlaps between habitat parcels. We keep both sides so each
-- offending parcel reports itself in c_overlap_offending below.
c_overlap_pairs AS (
  SELECT a.idx AS a_idx, a.props AS a_props,
         b.idx AS b_idx, b.props AS b_props,
         ST_Area(ST_Intersection(ST_MakeValid(a.geom), ST_MakeValid(b.geom), $11)) AS overlap_area
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
-- Slivers: gaps inside the redline not covered by any habitat parcel,
-- discarding the trivially small (GEOS noise on shared edges) and the trivially
-- large (legitimately uncovered land — that's a different check).
c_slivers AS (
  SELECT row_number() OVER (ORDER BY ST_Area(g)) - 1 AS id, ST_Area(g) AS area
  FROM (
    SELECT (ST_Dump(ST_Difference(r.geom, p.geom, $11))).geom AS g
    FROM redline_union r CROSS JOIN parcels_union p
    WHERE r.geom IS NOT NULL AND p.geom IS NOT NULL
  ) leftover
  WHERE ST_Area(g) > 0 AND ST_Area(g) < $7
),
-- Habitat parcels that fall (partially) outside the redline. Compares an area
-- difference rather than ST_Within so parcels sharing boundary edges with the
-- redline aren't false-flagged by GEOS robustness wobbles on shared vertices.
c_areas_outside AS (
  SELECT f.idx, f.props FROM areas f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL
    AND ST_Area(ST_Difference(ST_MakeValid(f.geom), r.geom, $11)) > $12
),
-- Linear / point habitat layers: simple containment is sufficient.
c_hedgerows_outside AS (
  SELECT f.idx, f.props FROM hedgerows f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(f.geom, r.geom)
),
c_watercourses_outside AS (
  SELECT f.idx, f.props FROM watercourses f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(f.geom, r.geom)
),
c_iggis_outside AS (
  SELECT f.idx, f.props FROM iggis f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(f.geom, r.geom)
),
c_trees_outside AS (
  SELECT f.idx, f.props FROM trees f CROSS JOIN redline_union r
  WHERE r.geom IS NOT NULL AND NOT ST_Within(f.geom, r.geom)
)

-- ---------------------------------------------------------------------------
-- Output: one row per triggered error. Codes match ERROR_CODES on the Node
-- side; payloads are consumed by ERROR_BUILDERS to construct the final error
-- objects. HAVING count(*) > 0 suppresses zero-row aggregates so passing
-- checks emit nothing at all.
-- ---------------------------------------------------------------------------

SELECT 'REDLINE_OUTSIDE_ENGLAND' AS code, '{}'::jsonb AS payload
FROM c_redline_outside_england
UNION ALL
SELECT 'REDLINE_AREA_TOO_LARGE', jsonb_build_object('total', total)
FROM c_redline_total WHERE total > $10
UNION ALL
SELECT 'NO_HABITAT_AREAS', '{}'::jsonb
FROM c_habitats_total WHERE n = 0
UNION ALL
SELECT 'REDLINE_INVALID_GEOMETRY',
       jsonb_build_object('reason', reason, 'location_wkt', location_wkt)
FROM c_redline_invalid
UNION ALL
SELECT 'AREA_PARCELS_INVALID_GEOMETRY',
       jsonb_build_object('offending',
         jsonb_agg(jsonb_build_object(
           'idx', idx, 'props', props,
           'reason', reason, 'location_wkt', location_wkt
         ) ORDER BY idx))
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

// Tolerance for the "parcel falls outside the redline" check. We compare the
// area of the difference rather than relying on a Boolean predicate so that
// parcels sharing boundary edges with the redline (the normal case) aren't
// false-positive-flagged by GEOS robustness wobbles on shared vertices.
const PARCEL_OUTSIDE_TOLERANCE_SQ_M = 0.5

// gridSize for PostGIS overlay ops (ST_Difference / ST_Intersection). With a
// fixed-precision grid GEOS computes overlays in deterministic integer
// arithmetic, eliminating the floating-point ghost components that otherwise
// turn shared-edge tilings into spurious zero-area slivers.
const OVERLAY_GRID_SIZE_M = 0.001

// Order matches the Turf-engine sequence so error output is stable across
// engines.
const ERROR_ORDER = [
  ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
  ERROR_CODES.REDLINE_AREA_TOO_LARGE,
  ERROR_CODES.NO_HABITAT_AREAS,
  ERROR_CODES.REDLINE_INVALID_GEOMETRY,
  ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
  ERROR_CODES.PARCEL_OVERLAPS,
  ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
  ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
  ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
  ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
  ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
  ERROR_CODES.TREES_OUTSIDE_REDLINE,
  ERROR_CODES.AREA_SUM_MISMATCH
]

function buildArrays(layers) {
  const layerNames = []
  const idxs = []
  const props = []
  const geoms = []
  const srids = []
  for (const layerName of LAYER_NAMES) {
    const features = layers[layerName] ?? []
    features.forEach((feature, index) => {
      // We use feature.nativeGeometry rather than feature.geometry because the
      // native form is raw/unprocessed in its source SRID, and PostGIS reprojects
      // it to 27700 in-query. feature.geometry has already been reprojected to
      // WGS84 by proj4 at read time, so feeding that in would run the (heavy)
      // CRS conversion twice.
      const geom = feature.nativeGeometry
      if (!geom) {
        return
      }
      layerNames.push(layerName)
      idxs.push(index)
      props.push(JSON.stringify(feature.properties ?? {}))
      geoms.push(JSON.stringify(geom))
      srids.push(feature.nativeSrid)
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
    MAX_REDLINE_AREA_SQ_M,
    OVERLAY_GRID_SIZE_M,
    PARCEL_OUTSIDE_TOLERANCE_SQ_M
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
