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
//   $13 numeric  OUTSIDE_BOUNDARY_TOLERANCE_M    — tolerance for boundary-grazing linear/point features (length-of-difference for lines, perpendicular distance for points)
//   $14 numeric  REDLINE_OUTSIDE_ENGLAND_TOLERANCE_SQ_M — area-difference tolerance for "redline outside England"
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
-- In plain English: subtract England from the redline; whatever's left is the
-- redline's escaping bit. Flag if its area exceeds the tolerance.
-- (Area-of-difference rather than strict ST_Within so coastline-adjacent
-- redlines aren't tripped by sub-millimetre numerical noise on the shared edge.)
c_redline_outside_england AS (
  SELECT 1 AS hit
  FROM redline feat, england engl
  WHERE ST_Area(ST_Difference(ST_MakeValid(feat.geom), engl.geom, $11)) > $14
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
-- Each remaining CTE just signals presence/absence of an issue (LIMIT 1
-- where possible) rather than carrying per-feature data, so the response
-- size stays bounded regardless of file size.
c_areas_invalid AS (
  SELECT 1 AS hit FROM areas WHERE NOT ST_IsValid(geom) LIMIT 1
),
c_overlap_offending AS (
  SELECT 1 AS hit
  FROM areas prc1 JOIN areas prc2
    ON prc1.idx < prc2.idx AND ST_Intersects(prc1.geom, prc2.geom)
  WHERE ST_Area(ST_Intersection(ST_MakeValid(prc1.geom), ST_MakeValid(prc2.geom), $11)) > $8
  LIMIT 1
),
-- Slivers: gaps inside the redline not covered by any habitat parcel,
-- discarding the trivially small (GEOS noise on shared edges) and the trivially
-- large (legitimately uncovered land — that's a different check).
c_slivers AS (
  SELECT 1 AS hit
  FROM (
    SELECT (ST_Dump(ST_Difference(redl.geom, parc.geom, $11))).geom AS g
    FROM redline_union redl CROSS JOIN parcels_union parc
    WHERE redl.geom IS NOT NULL AND parc.geom IS NOT NULL
  ) leftover
  WHERE ST_Area(g) > 0 AND ST_Area(g) < $7
  LIMIT 1
),
-- Habitat parcels that fall (partially) outside the redline.
-- In plain English: subtract the redline from each parcel; whatever's left is
-- the parcel's escaping bit. Flag if its area exceeds the tolerance.
-- (Area-of-difference rather than strict ST_Within so parcels sharing boundary
-- edges with the redline aren't false-flagged by GEOS robustness wobbles.)
c_areas_outside AS (
  SELECT 1 AS hit FROM areas feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL
    AND ST_Area(ST_Difference(ST_MakeValid(feat.geom), redl.geom, $11)) > $12
  LIMIT 1
),
-- Linear habitat layers (hedgerows, watercourses) that fall outside the redline.
-- In plain English: subtract the redline polygon from the feature line; whatever's
-- left is the bit of the line that escapes. Flag if its length exceeds
-- OUTSIDE_BOUNDARY_TOLERANCE_M.
-- (Length-of-difference rather than strict ST_Within so lines whose endpoints sit
-- on the redline boundary aren't false-flagged by GEOS robustness wobbles — a
-- vertex one ULP (Unit in the Last Place, the smallest representable float gap,
-- ~6e-11 m at British National Grid / EPSG:27700 magnitudes) outside the edge
-- gives ST_Within=false even though the geometric distance is zero.)
c_hedgerows_outside AS (
  SELECT 1 AS hit FROM hedgerows feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL
    AND ST_Length(ST_Difference(feat.geom, redl.geom, $11)) > $13
  LIMIT 1
),
c_watercourses_outside AS (
  SELECT 1 AS hit FROM watercourses feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL
    AND ST_Length(ST_Difference(feat.geom, redl.geom, $11)) > $13
  LIMIT 1
),
-- IGGIs (polygons in current uploads): same shape as c_areas_outside.
-- In plain English: subtract the redline from each IGGI; flag if the area of
-- whatever's left exceeds the tolerance. Reuses PARCEL_OUTSIDE_TOLERANCE_SQ_M
-- ($12) because both are area features sharing edges with the redline.
c_iggis_outside AS (
  SELECT 1 AS hit FROM iggis feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL
    AND ST_Area(ST_Difference(ST_MakeValid(feat.geom), redl.geom, $11)) > $12
  LIMIT 1
),
-- Trees are points.
-- In plain English: ST_DWithin(point, polygon, tol) is true if the point is
-- inside, on the boundary, or within tol metres outside. Flag any tree
-- where it's false.
-- (ST_Within alone returns FALSE for any point exactly on the boundary —
-- a point has no interior to intersect the polygon's interior.)
c_trees_outside AS (
  SELECT 1 AS hit FROM trees feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL AND NOT ST_DWithin(feat.geom, redl.geom, $13)
  LIMIT 1
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
SELECT 'AREA_PARCELS_INVALID_GEOMETRY', '{}'::jsonb
FROM c_areas_invalid
UNION ALL
SELECT 'PARCEL_OVERLAPS', '{}'::jsonb
FROM c_overlap_offending
UNION ALL
SELECT 'SLIVERS_INSIDE_REDLINE', '{}'::jsonb
FROM c_slivers
UNION ALL
SELECT 'AREA_PARCELS_OUTSIDE_REDLINE', '{}'::jsonb
FROM c_areas_outside
UNION ALL
SELECT 'HEDGEROWS_OUTSIDE_REDLINE', '{}'::jsonb
FROM c_hedgerows_outside
UNION ALL
SELECT 'WATERCOURSES_OUTSIDE_REDLINE', '{}'::jsonb
FROM c_watercourses_outside
UNION ALL
SELECT 'IGGIS_OUTSIDE_REDLINE', '{}'::jsonb
FROM c_iggis_outside
UNION ALL
SELECT 'TREES_OUTSIDE_REDLINE', '{}'::jsonb
FROM c_trees_outside
UNION ALL
SELECT 'AREA_SUM_MISMATCH',
       jsonb_build_object('redline_total', rtot.total, 'habitats_total', htot.total)
FROM c_redline_total rtot CROSS JOIN c_habitats_total htot
WHERE rtot.n > 0 AND htot.n > 0 AND abs(rtot.total - htot.total) > $9
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

// Tolerance for boundary-grazing linear and point features. For lines: the
// total length lying outside the redline must exceed this before the feature
// is flagged. For points: the perpendicular distance to the redline must
// exceed this. Same numeric value because both serve the same purpose —
// allowing features that QGIS has snapped to the redline edge.
const OUTSIDE_BOUNDARY_TOLERANCE_M = 0.1

// Tolerance for "redline outside England". The reference England polygon's
// coastline isn't perfectly aligned with any digitised redline, so a strict
// ST_Within trips on sub-mm numerical noise; same area-difference pattern as
// the habitat-parcel-outside-redline check.
const REDLINE_OUTSIDE_ENGLAND_TOLERANCE_SQ_M = 0.5

// Order matches the Turf-engine sequence so error output is stable across
// engines.
const ERROR_ORDER = [
  ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
  ERROR_CODES.REDLINE_AREA_TOO_LARGE,
  ERROR_CODES.NO_HABITAT_AREAS,
  ERROR_CODES.REDLINE_INVALID_GEOMETRY,
  ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
  ERROR_CODES.PARCEL_OVERLAPS,
  ERROR_CODES.SLIVERS_INSIDE_REDLINE,
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
      // Geometry stays in its native SRID until PostGIS reprojects it
      // in-query (ST_Transform on line 53).
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
    PARCEL_OUTSIDE_TOLERANCE_SQ_M,
    OUTSIDE_BOUNDARY_TOLERANCE_M,
    REDLINE_OUTSIDE_ENGLAND_TOLERANCE_SQ_M
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
