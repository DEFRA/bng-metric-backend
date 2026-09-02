/**
 * The fifteen geometry rules, run against GEOS in-process.
 *
 * Every function here began as a transliteration of one CTE in the PostGIS
 * statement this engine replaced — same tolerance, same predicate, same choice
 * between the geometry as supplied and its MakeValid repair. That statement is
 * gone now, so this file is the only remaining statement of what each rule is;
 * the verdicts the SQL used to produce are preserved as a regression fixture
 * (integration-tests/fixtures/postgis-geometry-verdicts.json).
 *
 * The raw/repaired split is the subtlest of them, and it is not arbitrary:
 *
 *  - area TOTALS and LINEAR differences read the geometry as supplied, because
 *    the SQL's `redline` / `areas` / `hedgerows` CTEs select `geom` unrepaired;
 *  - overlaps, parcel areas, containment and the dissolved unions read the
 *    repaired geometry, because those CTEs wrap it in `ST_MakeValid`.
 *
 * Getting that backwards changes verdicts on exactly the files where it matters
 * most — the ones with broken geometry — so it is asserted per check in the
 * unit tests and re-checked by the parity suite.
 */
import { ERROR_CODES } from '../errors.js'
import {
  AREA_SUM_TOLERANCE_SQ_M,
  MAX_REDLINE_AREA_SQ_M,
  MIN_PARCEL_AREA_SQ_M,
  OUTSIDE_BOUNDARY_TOLERANCE_M,
  OVERLAP_TOLERANCE_SQ_M,
  OVERLAY_GRID_SIZE_M,
  PARCEL_OUTSIDE_TOLERANCE_SQ_M,
  REDLINE_OUTSIDE_ENGLAND_TOLERANCE_SQ_M
} from '../geometry-constants.js'
import { englandGeometry } from './england.js'
import { candidatePairs } from './geometry.js'
import {
  featureListPayload,
  invalidGeometryPayload,
  outsideRedlinePayload,
  overlapPayload,
  sliverPayload,
  tooSmallPayload
} from './payloads.js'

/**
 * Total area of a layer's features, computed on the geometry as supplied.
 *
 * @param {import('./geometry.js').LoadedFeature[]} features
 * @param {import('./geos-runtime.js').GeosRuntime} runtime
 * @returns {number}
 */
function totalArea(features, runtime) {
  return features.reduce((sum, feature) => sum + runtime.area(feature.geom), 0)
}

/**
 * Area of `geometry` minus `subtrahend`, on the fixed-precision overlay grid —
 * the `ST_Area(ST_Difference(a, b, gridSize))` the SQL uses to measure how much
 * of a shape escapes another.
 */
function escapeArea(geometry, subtrahend, runtime) {
  const difference = runtime.geos.GEOSDifferencePrec(
    geometry,
    subtrahend,
    OVERLAY_GRID_SIZE_M
  )
  const area = runtime.area(difference)
  runtime.free(difference)
  return area
}

/**
 * Length of `geometry` minus `subtrahend`, on the fixed-precision overlay grid.
 * The linear-layer counterpart of {@link escapeArea}.
 */
function escapeLength(geometry, subtrahend, runtime) {
  const difference = runtime.geos.GEOSDifferencePrec(
    geometry,
    subtrahend,
    OVERLAY_GRID_SIZE_M
  )
  const length = runtime.length(difference)
  runtime.free(difference)
  return length
}

/**
 * True when the prepared redline covers `geometry` outright, so subtracting the
 * redline from it can only yield an empty result.
 *
 * This is a short-circuit the SQL does not need and does not have: PostgreSQL
 * reaches the same conclusion through the planner. It is safe in the strict
 * sense — "covers" implies an empty difference implies zero area or length,
 * which is below every tolerance here — so it can only skip work, never change
 * a verdict.
 */
function coveredByRedline(context, geometry) {
  return (
    context.runtime.geos.GEOSPreparedCovers(
      context.preparedRedline,
      geometry
    ) === 1
  )
}

/** NO_REDLINE — the file carries no redline boundary polygon at all. */
function checkNoRedline(context, emit) {
  if (context.layers.redline.length === 0) {
    emit(ERROR_CODES.NO_REDLINE, {})
  }
}

/** NO_HABITAT_AREAS — the file carries no area habitat polygons at all. */
function checkNoHabitatAreas(context, emit) {
  if (context.layers.areas.length === 0) {
    emit(ERROR_CODES.NO_HABITAT_AREAS, {})
  }
}

/** REDLINE_AREA_TOO_LARGE — the redline exceeds the 100 sq km cap. */
function checkRedlineTooLarge(context, emit) {
  if (context.redlineTotal > MAX_REDLINE_AREA_SQ_M) {
    emit(ERROR_CODES.REDLINE_AREA_TOO_LARGE, { total: context.redlineTotal })
  }
}

/**
 * REDLINE_OUTSIDE_ENGLAND — any part of the redline falls outside the England
 * reference polygon by more than the tolerance. The SQL stops at the first
 * offender (`LIMIT 1`) and so does this: the payload is empty, so a second
 * offender would add nothing.
 */
function checkRedlineOutsideEngland(context, emit) {
  const england = englandGeometry(context.runtime)
  const escaped = context.layers.redline.some(
    (feature) =>
      escapeArea(feature.valid, england, context.runtime) >
      REDLINE_OUTSIDE_ENGLAND_TOLERANCE_SQ_M
  )
  if (escaped) {
    emit(ERROR_CODES.REDLINE_OUTSIDE_ENGLAND, {})
  }
}

/**
 * REDLINE_INVALID_GEOMETRY — self-intersection, bad ring orientation, a hole
 * outside its shell, and so on. Reports the first offender in layer order with
 * the reason and the location, which is what the SQL's `LIMIT 1` over the
 * unordered scan resolves to.
 */
function checkRedlineInvalid(context, emit) {
  const offender = context.layers.redline.find(
    (feature) => !context.runtime.isValid(feature.geom)
  )
  if (!offender) {
    return
  }
  const detail = context.runtime.validDetail(offender.geom)
  const locationWkt = detail.location
    ? context.runtime.toWkt(detail.location)
    : null
  context.runtime.free(detail.location)
  emit(ERROR_CODES.REDLINE_INVALID_GEOMETRY, {
    reason: detail.reason,
    location_wkt: locationWkt
  })
}

/** AREA_PARCELS_INVALID_GEOMETRY — every invalid area habitat polygon. */
function checkAreaParcelsInvalid(context, emit) {
  const offenders = []
  for (const feature of context.layers.areas) {
    if (context.runtime.isValid(feature.geom)) {
      continue
    }
    const detail = context.runtime.validDetail(feature.geom)
    context.runtime.free(detail.location)
    offenders.push({ feature, reason: detail.reason })
  }
  if (offenders.length > 0) {
    emit(
      ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
      invalidGeometryPayload(offenders)
    )
  }
}

/**
 * PARCEL_OVERLAPS — every pair of area habitat parcels sharing more than the
 * tolerance.
 *
 * Runs on the repaired geometries, as the SQL does: the temp table the self-join
 * reads is materialised with `ST_MakeValid` already applied. That is what lets a
 * pair GEOS refuses to evaluate against the raw ring ("side location conflict")
 * be compared at all.
 */
function checkParcelOverlaps(context, emit) {
  const parcels = context.layers.areas
  const offenders = []

  for (const [left, right] of candidatePairs(parcels.map((p) => p.bbox))) {
    const a = parcels[left]
    const b = parcels[right]
    if (context.runtime.geos.GEOSIntersects(a.valid, b.valid) !== 1) {
      continue
    }
    const shared = context.runtime.geos.GEOSIntersectionPrec(
      a.valid,
      b.valid,
      OVERLAY_GRID_SIZE_M
    )
    const sharedArea = context.runtime.area(shared)
    context.runtime.free(shared)
    if (sharedArea > OVERLAP_TOLERANCE_SQ_M) {
      offenders.push({ a, b })
    }
  }

  if (offenders.length > 0) {
    emit(ERROR_CODES.PARCEL_OVERLAPS, overlapPayload(offenders))
  }
}

/** AREA_PARCELS_TOO_SMALL — parcels under the 1 sq m minimum. */
function checkAreaParcelsTooSmall(context, emit) {
  const offenders = context.layers.areas
    .map((feature) => ({
      feature,
      areaSqM: context.runtime.area(feature.valid)
    }))
    .filter(({ areaSqM }) => areaSqM < MIN_PARCEL_AREA_SQ_M)

  if (offenders.length > 0) {
    emit(ERROR_CODES.AREA_PARCELS_TOO_SMALL, tooSmallPayload(offenders))
  }
}

/**
 * AREA_PARCELS_OUTSIDE_REDLINE — parcels whose own footprint leaves the
 * redline, reported per parcel with the area and location of the escaping part.
 */
function checkAreaParcelsOutside(context, emit) {
  const offenders = []

  for (const feature of context.layers.areas) {
    if (coveredByRedline(context, feature.valid)) {
      continue
    }
    const escape = context.runtime.geos.GEOSDifferencePrec(
      feature.valid,
      context.redlineUnion,
      OVERLAY_GRID_SIZE_M
    )
    const escapeAreaSqM = context.runtime.area(escape)
    if (escapeAreaSqM > PARCEL_OUTSIDE_TOLERANCE_SQ_M) {
      offenders.push({
        feature,
        escapeAreaSqM,
        escapeWkt: context.runtime.toWkt(escape)
      })
    }
    context.runtime.free(escape)
  }

  if (offenders.length > 0) {
    emit(
      ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
      outsideRedlinePayload(offenders)
    )
  }
}

/**
 * SLIVERS_OUTSIDE_REDLINE — the same escaping land as the check above, but cut
 * the other way: the dissolved parcels minus the dissolved redline, split into
 * pieces. A single sliver spanning four parcels is one row here and four there.
 */
function checkSliversOutside(context, emit) {
  const parcelsUnion = context.runtime.unionAll(
    context.layers.areas.map((feature) =>
      context.runtime.geos.GEOSGeom_clone(feature.valid)
    )
  )
  if (!parcelsUnion) {
    return
  }

  const leftover = context.runtime.geos.GEOSDifferencePrec(
    parcelsUnion,
    context.redlineUnion,
    OVERLAY_GRID_SIZE_M
  )
  const pieces = []
  const count = context.runtime.geos.GEOSGetNumGeometries(leftover)
  for (let index = 0; index < count; index++) {
    const piece = context.runtime.geos.GEOSGetGeometryN(leftover, index)
    const areaSqM = context.runtime.area(piece)
    if (areaSqM > PARCEL_OUTSIDE_TOLERANCE_SQ_M) {
      pieces.push({ areaSqM, wkt: context.runtime.toWkt(piece) })
    }
  }
  context.runtime.free(leftover)
  context.runtime.free(parcelsUnion)

  if (pieces.length > 0) {
    emit(ERROR_CODES.SLIVERS_OUTSIDE_REDLINE, sliverPayload(pieces))
  }
}

/**
 * The linear layers — hedgerows and watercourses — flagged on the LENGTH of the
 * part outside the redline. Runs on the geometry as supplied, matching the SQL.
 */
function checkLinearOutside(context, emit, layerName, code) {
  const offenders = context.layers[layerName].filter(
    (feature) =>
      !coveredByRedline(context, feature.geom) &&
      escapeLength(feature.geom, context.redlineUnion, context.runtime) >
        OUTSIDE_BOUNDARY_TOLERANCE_M
  )
  if (offenders.length > 0) {
    emit(code, featureListPayload(offenders))
  }
}

/** IGGIS_OUTSIDE_REDLINE — polygons, so flagged on area like the parcels are. */
function checkIggisOutside(context, emit) {
  const offenders = context.layers.iggis.filter(
    (feature) =>
      !coveredByRedline(context, feature.valid) &&
      escapeArea(feature.valid, context.redlineUnion, context.runtime) >
        PARCEL_OUTSIDE_TOLERANCE_SQ_M
  )
  if (offenders.length > 0) {
    emit(ERROR_CODES.IGGIS_OUTSIDE_REDLINE, featureListPayload(offenders))
  }
}

/**
 * TREES_OUTSIDE_REDLINE — points, so flagged on DISTANCE. A tree exactly on the
 * boundary passes: a point has no interior to intersect the polygon's, so a
 * strict within-test would reject every tree a surveyor snapped to the edge.
 */
function checkTreesOutside(context, emit) {
  const offenders = context.layers.trees.filter(
    (feature) =>
      context.runtime.geos.GEOSPreparedDistanceWithin(
        context.preparedRedline,
        feature.geom,
        OUTSIDE_BOUNDARY_TOLERANCE_M
      ) !== 1
  )
  if (offenders.length > 0) {
    emit(ERROR_CODES.TREES_OUTSIDE_REDLINE, featureListPayload(offenders))
  }
}

/**
 * AREA_SUM_MISMATCH — the parcels should tile the redline exactly. Only
 * meaningful when both layers carry features, hence the guard the SQL also
 * applies.
 */
function checkAreaSumMismatch(context, emit) {
  const { redlineTotal, habitatsTotal } = context
  if (
    context.layers.redline.length === 0 ||
    context.layers.areas.length === 0
  ) {
    return
  }
  if (Math.abs(redlineTotal - habitatsTotal) > AREA_SUM_TOLERANCE_SQ_M) {
    emit(ERROR_CODES.AREA_SUM_MISMATCH, {
      redline_total: redlineTotal,
      habitats_total: habitatsTotal
    })
  }
}

/**
 * The checks that need a dissolved redline to compare against. Skipped wholesale
 * when the file has no redline — which is exactly what the SQL's
 * `WHERE redl.geom IS NOT NULL` does, and why a file with no redline reports
 * NO_REDLINE alone rather than also reporting every parcel as outside it.
 */
function runRedlineDependentChecks(context, emit) {
  checkRedlineOutsideEngland(context, emit)
  checkAreaParcelsOutside(context, emit)
  checkSliversOutside(context, emit)
  checkLinearOutside(
    context,
    emit,
    'hedgerows',
    ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE
  )
  checkLinearOutside(
    context,
    emit,
    'watercourses',
    ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE
  )
  checkIggisOutside(context, emit)
  checkTreesOutside(context, emit)
}

/**
 * Run every geometry check over already-loaded layers.
 *
 * @param {Record<string, import('./geometry.js').LoadedFeature[]>} layers
 * @param {import('./geos-runtime.js').GeosRuntime} runtime
 * @returns {Map<string, object>} error code -> payload, for the codes that fired
 */
export function runChecks(layers, runtime) {
  const payloads = new Map()
  const emit = (code, payload) => payloads.set(code, payload)

  const context = {
    runtime,
    layers,
    redlineTotal: totalArea(layers.redline, runtime),
    habitatsTotal: totalArea(layers.areas, runtime),
    redlineUnion: null,
    preparedRedline: null
  }

  checkNoRedline(context, emit)
  checkNoHabitatAreas(context, emit)
  checkRedlineTooLarge(context, emit)
  checkRedlineInvalid(context, emit)
  checkAreaParcelsInvalid(context, emit)
  checkParcelOverlaps(context, emit)
  checkAreaParcelsTooSmall(context, emit)

  context.redlineUnion = runtime.unionAll(
    layers.redline.map((feature) => runtime.geos.GEOSGeom_clone(feature.valid))
  )
  if (context.redlineUnion) {
    context.preparedRedline = runtime.geos.GEOSPrepare(context.redlineUnion)
    try {
      runRedlineDependentChecks(context, emit)
    } finally {
      runtime.geos.GEOSPreparedGeom_destroy(context.preparedRedline)
      runtime.free(context.redlineUnion)
    }
  }

  checkAreaSumMismatch(context, emit)

  return payloads
}
