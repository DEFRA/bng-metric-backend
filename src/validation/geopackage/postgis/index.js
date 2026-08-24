import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ERROR_CODES } from '../errors.js'
import { toGeometryJson } from '../geometry-json.js'
import { ERROR_BUILDERS } from './error-builders.js'
import { createLogger } from '../../../common/helpers/logging/logger.js'
import {
  logPerf,
  perfNow,
  msSince
} from '../../../common/helpers/perf-evidence.js'

const logger = createLogger()

// Single-statement validation: the layer features are passed in as parallel
// arrays of GeoJSON strings, parsed and reprojected to EPSG:27700 inside the
// query, used for every spatial check, and discarded when the statement
// finishes. Nothing is persisted server-side.

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const englandGeoJson = JSON.parse(
  fs.readFileSync(
    path.join(moduleDir, '..', '..', 'reference', 'england.geojson'),
    'utf8'
  )
)
const ENGLAND_GEOMETRY_JSON = JSON.stringify(englandGeoJson.geometry)

// Tolerance / threshold constants — interpolated into CHECK_QUERY at module
// load time (they're static JS values, not user input, so direct string
// interpolation is safe and makes the SQL self-documenting).

// Minimum area for a habitat parcel. Below this it is a digitising artefact
// rather than a habitat anyone intended to record. Purely an area test —
// shape is not considered, so a compact 0.9 m × 0.9 m parcel fails while a
// 100 m × 1 m one passes. Applied to the parcel's own footprint as supplied in
// the file; gaps *between* parcels are not checked, because the
// redline-vs-total-parcel-area comparison (AREA_SUM_MISMATCH) already accounts
// for any land the parcels fail to cover.
const MIN_PARCEL_AREA_SQ_M = 1
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

// Per-error-code cap on the number of offending features included in the
// `details.sample` array of the response. The total `details.count` is always
// truthful; the sample is bounded so a malformed file with thousands of
// offenders can't blow up the response. Tunable.
const ERROR_LIST_SAMPLE_CAP = 50

// SQL fragment that resolves each layer's user-facing reference column.
// Different layers carry the value under different property names: Parcel Ref
// (Habitats / Hedgerows / Rivers), Tree Ref (Urban Trees), Baseline Parcel Ref
// (Water course enhancement…). NULL flows through to the JS-side describeFeature
// helper which falls back to fid, then to "feature #idx".
function featureRefSql(propsExpr = 'props') {
  return `COALESCE(${propsExpr}->>'Parcel Ref', ${propsExpr}->>'Tree Ref', ${propsExpr}->>'Baseline Parcel Ref')`
}

// SQL fragment that extracts the SQLite primary key (fid) from the per-feature
// props JSONB. Centralising the property name avoids repeating the literal in
// every CTE that selects an identifier.
function fidColumnSql(propsExpr = 'props') {
  return `${propsExpr}->>'fid'`
}

// Most layer-level CTEs alias the per-feature row as `feat`, so reading its
// props goes through `feat.props`. Holding the expression in a constant keeps
// the literal from being repeated across every CTE that selects identifiers.
const FEAT_PROPS = 'feat.props'

// Baseline geometry validation, run as a single PostGIS statement — over the
// same $1..$5 arrays MATERIALISE_AREAS_QUERY has already been given, plus the
// England polygon. Features are passed in as parallel arrays of GeoJSON
// strings, parsed and reprojected to EPSG:27700 inside the query, used for
// every spatial check, and discarded when the statement finishes. The only
// pre-existing relation it reads is the parcels temp table. Nothing is
// persisted.
//
// Parameters
//   $1  text[]   layer names per feature (redline | areas | hedgerows | watercourses | iggis | trees)
//   $2  int[]    feature index within its layer (preserves source ordering)
//   $3  text[]   feature properties as JSONB strings
//   $4  text[]   feature geometry as GeoJSON strings
//   $5  int[]    native SRID per feature (geometry reprojected to 27700)
//   $6  text     England reference polygon as GeoJSON (EPSG:4326)
//
// All numeric tolerances are interpolated as JS template values directly
// into the query (see the constants above) so each check reads as
// `> PARCEL_OUTSIDE_TOLERANCE_SQ_M` rather than `> $12`.
//
// Output: one row per triggered error code, with `code` (text) and `payload`
// (jsonb). The NodeJS side maps each row through ERROR_BUILDERS and orders them
// via ERROR_ORDER.

// TIP: use the VS Code extension "bierner.comment-tagged-templates" to get SQL syntax
// highlighting after the /* sql */ comment.

// Session-local table holding the area habitat parcels, materialised so the
// parcel-overlap self-join has something the planner can put a spatial index
// on. Dropped automatically when the surrounding transaction ends.
const AREAS_TEMP_TABLE = 'areas_g'

// Reproject every input feature to EPSG:27700 (British National Grid). All
// subsequent area / containment maths is in metres on this CRS. Shared by the
// materialise step and the main check query so both read the same parameters
// the same way.
const FEATURES_IN_CTE = /* sql */ `
features_in AS (
  SELECT layer, idx, props::jsonb AS props,
         ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), 27700) AS geom
  FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::int[])
    AS t(layer, idx, props, g, srid)
)`

// Materialise the area habitat parcels into a real (temporary) table.
//
// The overlap check is a self-join over the parcels. Against the inline
// `areas` view — an ephemeral rowset over unnest()ed parameter arrays — the
// planner has no index and no statistics, so it walks all ~N²/2 idx pairs and
// runs ST_Intersects on each. Materialising gives the geometries a home a GiST
// index can be built on, which turns that cross-product into an index-backed
// spatial join.
//
// ST_MakeValid is applied once here rather than per pair inside the join.
//
// Takes $1..$5 (see CHECK_QUERY); ON COMMIT DROP ties the table's lifetime to
// the caller's transaction, so nothing is left behind on the pooled connection.
const MATERIALISE_AREAS_QUERY = /* sql */ `
CREATE TEMP TABLE ${AREAS_TEMP_TABLE} ON COMMIT DROP AS
WITH ${FEATURES_IN_CTE}
SELECT idx, props, ST_MakeValid(geom) AS geom
FROM features_in
WHERE layer = 'areas'`

// GiST index for bounding-box candidate pruning, then ANALYZE so the planner
// has the row counts and selectivity estimates it needs to actually choose the
// index path (a freshly created table has no statistics at all).
const INDEX_AREAS_QUERY = /* sql */ `
CREATE INDEX ON ${AREAS_TEMP_TABLE} USING gist (geom);
ANALYZE ${AREAS_TEMP_TABLE};`

const CHECK_QUERY = /* sql */ `
WITH
${FEATURES_IN_CTE},
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
  WHERE ST_Area(ST_Difference(ST_MakeValid(feat.geom), engl.geom, ${OVERLAY_GRID_SIZE_M})) > ${REDLINE_OUTSIDE_ENGLAND_TOLERANCE_SQ_M}
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
-- Each remaining CTE returns one row per offending feature so the final
-- UNION ALL can aggregate count + capped sample for the response. Per-layer
-- offenders carry idx (position within the layer), fid (SQLite primary key),
-- and feature_ref (Parcel Ref / Tree Ref / Baseline Parcel Ref — first
-- non-null wins).

-- List every self-intersecting / invalid area habitat polygon.
c_areas_invalid AS (
  SELECT idx,
         ${fidColumnSql()} AS fid,
         ${featureRefSql()} AS feature_ref,
         (ST_IsValidDetail(geom)).reason AS reason
  FROM areas
  WHERE NOT ST_IsValid(geom)
),
-- List every overlapping pair (idx_a < idx_b avoids duplicates).
-- Reads the GiST-indexed temp table rather than the inline areas view so
-- the planner prunes candidate pairs by bounding box instead of testing
-- every pair; its geometries are already valid, so no per-pair ST_MakeValid.
-- That means ST_Intersects sees repaired geometry too: an invalid parcel is
-- compared as the shape ST_MakeValid resolves it into, and a pair GEOS refuses
-- to evaluate against the raw ring ("side location conflict") no longer takes
-- the whole check down. See the invalid-parcel overlap cases in
-- integration-tests/postgis-validate-baseline-layers.test.js.
c_overlap_offending AS (
  SELECT prc1.idx AS idx_a,
         ${fidColumnSql('prc1.props')} AS fid_a,
         ${featureRefSql('prc1.props')} AS feature_ref_a,
         prc2.idx AS idx_b,
         ${fidColumnSql('prc2.props')} AS fid_b,
         ${featureRefSql('prc2.props')} AS feature_ref_b
  FROM ${AREAS_TEMP_TABLE} prc1 JOIN ${AREAS_TEMP_TABLE} prc2
    ON prc1.idx < prc2.idx AND ST_Intersects(prc1.geom, prc2.geom)
  WHERE ST_Area(ST_Intersection(prc1.geom, prc2.geom, ${OVERLAY_GRID_SIZE_M})) > ${OVERLAP_TOLERANCE_SQ_M}
),
-- Area habitat parcels whose own footprint is under MIN_PARCEL_AREA_SQ_M as
-- supplied in the file. Area only — a parcel is not judged on how thin or
-- elongated it is. Reported per parcel, with the area, so the user can find the
-- offending polygon and redraw it. Zero-area parcels are included: unlike
-- derived overlay geometry, a parcel the file itself declares with no area is
-- always a mistake.
c_areas_too_small AS (
  SELECT idx,
         ${fidColumnSql()} AS fid,
         ${featureRefSql()} AS feature_ref,
         ST_Area(ST_MakeValid(geom)) AS area_sqm
  FROM areas
  WHERE ST_Area(ST_MakeValid(geom)) < ${MIN_PARCEL_AREA_SQ_M}
),
-- Habitat parcel parts that fall outside the redline, reported as the
-- *escaping geometry* rather than as a list of parcels (the per-parcel view
-- below does that). Subtract the redline from the dissolved parcels and dump
-- the result into individual pieces; each piece bigger than
-- PARCEL_OUTSIDE_TOLERANCE_SQ_M is a sliver that shouldn't be there. Threshold
-- matches the per-parcel view so boundary noise from shared edges is suppressed
-- in both.
c_slivers_outside AS (
  SELECT ST_Area(g) AS area_sqm,
         ST_AsText(g) AS location_wkt
  FROM (
    SELECT (ST_Dump(ST_Difference(parc.geom, redl.geom, ${OVERLAY_GRID_SIZE_M}))).geom AS g
    FROM parcels_union parc CROSS JOIN redline_union redl
    WHERE parc.geom IS NOT NULL AND redl.geom IS NOT NULL
  ) leftover
  WHERE ST_Area(g) > ${PARCEL_OUTSIDE_TOLERANCE_SQ_M}
),
-- Habitat parcels that fall (partially) outside the redline.
-- In plain English: subtract the redline from each parcel; whatever's left is
-- the parcel's escaping bit. Flag if its area exceeds the tolerance.
-- (Area-of-difference rather than strict ST_Within so parcels sharing boundary
-- edges with the redline aren't false-flagged by GEOS robustness wobbles.)
-- Also exposes the escape geometry's area + WKT so the per-parcel report can
-- be merged with the per-piece sliver view into a single line in the UI.
c_areas_outside AS (
  SELECT idx, fid, feature_ref,
         ST_Area(escape) AS escape_area_sqm,
         ST_AsText(escape) AS escape_location_wkt
  FROM (
    SELECT feat.idx,
           ${fidColumnSql(FEAT_PROPS)} AS fid,
           ${featureRefSql(FEAT_PROPS)} AS feature_ref,
           ST_Difference(ST_MakeValid(feat.geom), redl.geom, ${OVERLAY_GRID_SIZE_M}) AS escape
    FROM areas feat CROSS JOIN redline_union redl
    WHERE redl.geom IS NOT NULL
  ) sub
  WHERE ST_Area(escape) > ${PARCEL_OUTSIDE_TOLERANCE_SQ_M}
),
-- Linear habitat layers (hedgerows, watercourses) outside the redline.
-- In plain English: subtract the redline polygon from the feature line; whatever's
-- left is the bit of the line that escapes. Flag if its length exceeds
-- OUTSIDE_BOUNDARY_TOLERANCE_M.
-- (Length-of-difference rather than strict ST_Within so lines whose endpoints sit
-- on the redline boundary aren't false-flagged by GEOS robustness wobbles — a
-- vertex one ULP (Unit in the Last Place, the smallest representable float gap,
-- ~6e-11 m at British National Grid / EPSG:27700 magnitudes) outside the edge
-- gives ST_Within=false even though the geometric distance is zero.)
c_hedgerows_outside AS (
  SELECT feat.idx,
         ${fidColumnSql(FEAT_PROPS)} AS fid,
         ${featureRefSql(FEAT_PROPS)} AS feature_ref
  FROM hedgerows feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL
    AND ST_Length(ST_Difference(feat.geom, redl.geom, ${OVERLAY_GRID_SIZE_M})) > ${OUTSIDE_BOUNDARY_TOLERANCE_M}
),
c_watercourses_outside AS (
  SELECT feat.idx,
         ${fidColumnSql(FEAT_PROPS)} AS fid,
         ${featureRefSql(FEAT_PROPS)} AS feature_ref
  FROM watercourses feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL
    AND ST_Length(ST_Difference(feat.geom, redl.geom, ${OVERLAY_GRID_SIZE_M})) > ${OUTSIDE_BOUNDARY_TOLERANCE_M}
),
-- IGGIs (polygons in current uploads): same shape as c_areas_outside.
-- In plain English: subtract the redline from each IGGI; flag if the area of
-- whatever's left exceeds the tolerance. Reuses PARCEL_OUTSIDE_TOLERANCE_SQ_M
-- because both are area features sharing edges with the redline.
c_iggis_outside AS (
  SELECT feat.idx,
         ${fidColumnSql(FEAT_PROPS)} AS fid,
         ${featureRefSql(FEAT_PROPS)} AS feature_ref
  FROM iggis feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL
    AND ST_Area(ST_Difference(ST_MakeValid(feat.geom), redl.geom, ${OVERLAY_GRID_SIZE_M})) > ${PARCEL_OUTSIDE_TOLERANCE_SQ_M}
),
-- Trees are points.
-- In plain English: ST_DWithin(point, polygon, tol) is true if the point is
-- inside, on the boundary, or within tol metres outside. Flag any tree
-- where it's false.
-- (ST_Within alone returns FALSE for any point exactly on the boundary —
-- a point has no interior to intersect the polygon's interior.)
c_trees_outside AS (
  SELECT feat.idx,
         ${fidColumnSql(FEAT_PROPS)} AS fid,
         ${featureRefSql(FEAT_PROPS)} AS feature_ref
  FROM trees feat CROSS JOIN redline_union redl
  WHERE redl.geom IS NOT NULL AND NOT ST_DWithin(feat.geom, redl.geom, ${OUTSIDE_BOUNDARY_TOLERANCE_M})
)

-- ---------------------------------------------------------------------------
-- Output: one row per triggered error. Codes match ERROR_CODES on the Node
-- side; payloads are consumed by ERROR_BUILDERS to construct the final error
-- objects. HAVING count(*) > 0 suppresses zero-row aggregates so passing
-- checks emit nothing at all.
-- ---------------------------------------------------------------------------

SELECT 'NO_REDLINE' AS code, '{}'::jsonb AS payload
FROM c_redline_total WHERE n = 0
UNION ALL
SELECT 'REDLINE_OUTSIDE_ENGLAND', '{}'::jsonb
FROM c_redline_outside_england
UNION ALL
SELECT 'REDLINE_AREA_TOO_LARGE', jsonb_build_object('total', total)
FROM c_redline_total WHERE total > ${MAX_REDLINE_AREA_SQ_M}
UNION ALL
SELECT 'NO_HABITAT_AREAS', '{}'::jsonb
FROM c_habitats_total WHERE n = 0
UNION ALL
SELECT 'REDLINE_INVALID_GEOMETRY',
       jsonb_build_object('reason', reason, 'location_wkt', location_wkt)
FROM c_redline_invalid
UNION ALL
SELECT 'AREA_PARCELS_INVALID_GEOMETRY',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx', idx, 'fid', fid, 'feature_ref', feature_ref, 'reason', reason) ORDER BY idx)
           FROM (SELECT idx, fid, feature_ref, reason FROM c_areas_invalid ORDER BY idx LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_areas_invalid
HAVING count(*) > 0
UNION ALL
SELECT 'PARCEL_OVERLAPS',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx_a', idx_a, 'fid_a', fid_a, 'feature_ref_a', feature_ref_a, 'idx_b', idx_b, 'fid_b', fid_b, 'feature_ref_b', feature_ref_b) ORDER BY idx_a, idx_b)
           FROM (SELECT * FROM c_overlap_offending ORDER BY idx_a, idx_b LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_overlap_offending
HAVING count(*) > 0
UNION ALL
SELECT 'AREA_PARCELS_TOO_SMALL',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx', idx, 'fid', fid, 'feature_ref', feature_ref, 'area_sqm', area_sqm) ORDER BY idx)
           FROM (SELECT idx, fid, feature_ref, area_sqm FROM c_areas_too_small ORDER BY idx LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_areas_too_small
HAVING count(*) > 0
UNION ALL
SELECT 'SLIVERS_OUTSIDE_REDLINE',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('area_sqm', area_sqm, 'location_wkt', location_wkt) ORDER BY area_sqm DESC)
           FROM (SELECT area_sqm, location_wkt FROM c_slivers_outside ORDER BY area_sqm DESC LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_slivers_outside
HAVING count(*) > 0
UNION ALL
SELECT 'AREA_PARCELS_OUTSIDE_REDLINE',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx', idx, 'fid', fid, 'feature_ref', feature_ref, 'escape_area_sqm', escape_area_sqm, 'escape_location_wkt', escape_location_wkt) ORDER BY idx)
           FROM (SELECT idx, fid, feature_ref, escape_area_sqm, escape_location_wkt FROM c_areas_outside ORDER BY idx LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_areas_outside
HAVING count(*) > 0
UNION ALL
SELECT 'HEDGEROWS_OUTSIDE_REDLINE',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx', idx, 'fid', fid, 'feature_ref', feature_ref) ORDER BY idx)
           FROM (SELECT idx, fid, feature_ref FROM c_hedgerows_outside ORDER BY idx LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_hedgerows_outside
HAVING count(*) > 0
UNION ALL
SELECT 'WATERCOURSES_OUTSIDE_REDLINE',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx', idx, 'fid', fid, 'feature_ref', feature_ref) ORDER BY idx)
           FROM (SELECT idx, fid, feature_ref FROM c_watercourses_outside ORDER BY idx LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_watercourses_outside
HAVING count(*) > 0
UNION ALL
SELECT 'IGGIS_OUTSIDE_REDLINE',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx', idx, 'fid', fid, 'feature_ref', feature_ref) ORDER BY idx)
           FROM (SELECT idx, fid, feature_ref FROM c_iggis_outside ORDER BY idx LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_iggis_outside
HAVING count(*) > 0
UNION ALL
SELECT 'TREES_OUTSIDE_REDLINE',
       jsonb_build_object(
         'count', count(*),
         'sample', (
           SELECT jsonb_agg(jsonb_build_object('idx', idx, 'fid', fid, 'feature_ref', feature_ref) ORDER BY idx)
           FROM (SELECT idx, fid, feature_ref FROM c_trees_outside ORDER BY idx LIMIT ${ERROR_LIST_SAMPLE_CAP}) s
         )
       )
FROM c_trees_outside
HAVING count(*) > 0
UNION ALL
SELECT 'AREA_SUM_MISMATCH',
       jsonb_build_object('redline_total', rtot.total, 'habitats_total', htot.total)
FROM c_redline_total rtot CROSS JOIN c_habitats_total htot
WHERE rtot.n > 0 AND htot.n > 0 AND abs(rtot.total - htot.total) > ${AREA_SUM_TOLERANCE_SQ_M}
`

const LAYER_NAMES = [
  'redline',
  'areas',
  'hedgerows',
  'watercourses',
  'iggis',
  'trees'
]

// Order matches the Turf-engine sequence so error output is stable across
// engines.
const ERROR_ORDER = [
  ERROR_CODES.NO_REDLINE,
  ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
  ERROR_CODES.REDLINE_AREA_TOO_LARGE,
  ERROR_CODES.NO_HABITAT_AREAS,
  ERROR_CODES.REDLINE_INVALID_GEOMETRY,
  ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
  ERROR_CODES.PARCEL_OVERLAPS,
  ERROR_CODES.AREA_PARCELS_TOO_SMALL,
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
      // Geometry stays in its native SRID until PostGIS reprojects it
      // in-query (ST_Transform on line 53).
      const geom = feature.nativeGeometry
      if (!geom) {
        return
      }
      layerNames.push(layerName)
      idxs.push(index)
      props.push(JSON.stringify(feature.properties ?? {}))
      geoms.push(toGeometryJson(feature.geometryJson, geom))
      srids.push(feature.nativeSrid)
    })
  }
  return { layerNames, idxs, props, geoms, srids }
}

/**
 * Materialise the area habitat parcels into a GiST-indexed temp table on the
 * given client, and return the parameter arrays built from `layers` so the
 * caller can reuse them for the main check query.
 *
 * Must be called inside a transaction: the table is ON COMMIT DROP, so the
 * surrounding COMMIT / ROLLBACK is what cleans it off the pooled connection.
 *
 * @param {import('pg').ClientBase} client Client with an open transaction
 * @param {object} layers Output of readGeoPackage
 */
export async function materialiseIndexedAreas(client, layers) {
  const arrays = buildArrays(layers)
  const { layerNames, idxs, props, geoms, srids } = arrays

  await client.query(MATERIALISE_AREAS_QUERY, [
    layerNames,
    idxs,
    props,
    geoms,
    srids
  ])
  await client.query(INDEX_AREAS_QUERY)

  return arrays
}

/**
 * Run every baseline geometry check in a single PostGIS statement. No data is
 * persisted: features are passed in as parameters, parsed in-query, used for
 * the spatial checks, and discarded when the transaction ends.
 *
 * The one exception is the area habitat parcels, which are materialised into a
 * temporary table so the overlap self-join can use a spatial index. That table
 * is ON COMMIT DROP, hence the explicit transaction on a dedicated client — it
 * disappears when the transaction ends, whichever way it ends.
 *
 * @param {import('pg').Pool} pool
 * @param {object} layers Output of readGeoPackage
 */
export async function validateGeoPackageLayersPostgis(pool, layers) {
  const client = await pool.connect()
  let rows
  // Stays undefined on the happy path. If the rollback itself fails the
  // connection can't be trusted back in the pool still inside a transaction,
  // so the error is handed to release() and pg destroys the client instead.
  let releaseError
  try {
    await client.query('BEGIN')
    const materialiseStart = perfNow()
    const { layerNames, idxs, props, geoms, srids } =
      await materialiseIndexedAreas(client, layers)
    const materialiseMs = msSince(materialiseStart)

    const checkStart = perfNow()
    ;({ rows } = await client.query(CHECK_QUERY, [
      layerNames,
      idxs,
      props,
      geoms,
      srids,
      ENGLAND_GEOMETRY_JSON
    ]))
    const checkMs = msSince(checkStart)
    await client.query('COMMIT')

    // Evidence (Item 6 — the heavy geometry validation is one giant inline
    // statement): every check runs as a single awaited query with repeated
    // ST_MakeValid / ST_Union / overlay work across all layers, so nothing can
    // fail fast and nothing can be parallelised.
    //
    // materialiseMs is the temp-table load plus GiST index build that BMD-911
    // added to make the parcel-overlap self-join sub-quadratic; it is split out
    // so the cost of the index is visible against what it saves in checkMs.
    logPerf(logger, 'postgis-inline-heavy-query', {
      totalFeatures: geoms.length,
      areaFeatureCount: layerNames.filter((name) => name === 'areas').length,
      materialiseMs,
      checkMs,
      queryMs: materialiseMs + checkMs
    })
  } catch (err) {
    releaseError = await client.query('ROLLBACK').then(
      () => undefined,
      (rollbackErr) => rollbackErr
    )
    throw err
  } finally {
    client.release(releaseError)
  }

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
