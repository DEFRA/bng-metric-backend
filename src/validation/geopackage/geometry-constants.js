/**
 * Tolerances, thresholds and caps shared by every geometry-validation engine.
 *
 * These numbers are the validation policy. They used to live inside
 * `postgis/index.js`, interpolated into the SQL at module load. With a second
 * engine (`geos/`) running the same fifteen checks in-process, a copied
 * constant is a silent divergence waiting to happen — the two engines would
 * agree until someone tuned one of them. Holding them here means the PostGIS
 * statement and the GEOS checks cannot disagree about a threshold: they read
 * the same value.
 *
 * Everything is in EPSG:27700 units — metres and square metres.
 */

/**
 * Minimum area for a habitat parcel. Below this it is a digitising artefact
 * rather than a habitat anyone intended to record. Purely an area test —
 * shape is not considered, so a compact 0.9 m x 0.9 m parcel fails while a
 * 100 m x 1 m one passes. Applied to the parcel's own footprint as supplied in
 * the file; gaps *between* parcels are not checked, because the
 * redline-vs-total-parcel-area comparison (AREA_SUM_MISMATCH) already accounts
 * for any land the parcels fail to cover.
 */
export const MIN_PARCEL_AREA_SQ_M = 1

/** Minimum intersection area before two habitat parcels count as overlapping. */
export const OVERLAP_TOLERANCE_SQ_M = 0.5

/** Allowed difference between the redline area and the summed parcel areas. */
export const AREA_SUM_TOLERANCE_SQ_M = 0.5

/** Upper bound on the redline boundary — 100 square kilometres. */
export const MAX_REDLINE_AREA_SQ_M = 100 * 1000 * 1000

/**
 * Tolerance for the "parcel falls outside the redline" check. We compare the
 * area of the difference rather than relying on a Boolean predicate so that
 * parcels sharing boundary edges with the redline (the normal case) aren't
 * false-positive-flagged by GEOS robustness wobbles on shared vertices.
 */
export const PARCEL_OUTSIDE_TOLERANCE_SQ_M = 0.5

/**
 * gridSize for overlay ops (difference / intersection). With a fixed-precision
 * grid GEOS computes overlays in deterministic integer arithmetic, eliminating
 * the floating-point ghost components that otherwise turn shared-edge tilings
 * into spurious zero-area slivers.
 *
 * PostGIS passes this as the third argument to ST_Difference / ST_Intersection;
 * the GEOS engine passes it to GEOSDifferencePrec / GEOSIntersectionPrec, which
 * is the same GEOS entry point underneath.
 */
export const OVERLAY_GRID_SIZE_M = 0.001

/**
 * Tolerance for boundary-grazing linear and point features. For lines: the
 * total length lying outside the redline must exceed this before the feature
 * is flagged. For points: the perpendicular distance to the redline must
 * exceed this. Same numeric value because both serve the same purpose —
 * allowing features that QGIS has snapped to the redline edge.
 */
export const OUTSIDE_BOUNDARY_TOLERANCE_M = 0.1

/**
 * Tolerance for "redline outside England". The reference England polygon's
 * coastline isn't perfectly aligned with any digitised redline, so a strict
 * within-test trips on sub-mm numerical noise; same area-difference pattern as
 * the habitat-parcel-outside-redline check.
 */
export const REDLINE_OUTSIDE_ENGLAND_TOLERANCE_SQ_M = 0.5

/**
 * Per-error-code cap on the number of offending features included in the
 * `details.sample` array of the response. The total `details.count` is always
 * truthful; the sample is bounded so a malformed file with thousands of
 * offenders can't blow up the response. Tunable.
 */
export const ERROR_LIST_SAMPLE_CAP = 50

/**
 * Logical layer names, in the order both engines walk them. The order fixes
 * the `idx` a feature is reported under, so it is part of the payload contract
 * rather than an implementation detail.
 */
export const LAYER_NAMES = Object.freeze([
  'redline',
  'areas',
  'hedgerows',
  'watercourses',
  'iggis',
  'trees'
])
