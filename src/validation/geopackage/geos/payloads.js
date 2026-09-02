/**
 * Builders for the `details` payloads `error-builders.js` consumes.
 *
 * This module is the compatibility contract with the PostGIS statement this
 * engine replaced. `error-builders.js` renders the user-facing message from
 * these payloads and is unchanged from when the SQL produced them, so keeping
 * the payload shape keeps the wording identical.
 *
 * That makes three things load-bearing, and all three are reproduced here:
 *
 *  - the field names, which are snake_case because they came out of
 *    `jsonb_build_object` (`feature_ref`, `idx_a`, `area_sqm`, ...);
 *  - the sample ORDER, which the SQL fixes with an explicit `ORDER BY` — by
 *    `idx`, by `(idx_a, idx_b)` for overlap pairs, or by `area_sqm DESC` for
 *    slivers;
 *  - the 50-row cap, with a `count` that stays truthful past it, so a file with
 *    thousands of offenders reports "... (and 4,950 more)" rather than a
 *    truncated total.
 */
import { ERROR_LIST_SAMPLE_CAP } from '../geometry-constants.js'

/** Order offenders by their position within the layer. */
const byIdx = (a, b) => a.idx - b.idx

/** Order overlap pairs the way the SQL's `ORDER BY idx_a, idx_b` does. */
const byPairIdx = (a, b) => a.idx_a - b.idx_a || a.idx_b - b.idx_b

/** Order sliver pieces largest first, matching `ORDER BY area_sqm DESC`. */
const byAreaDescending = (a, b) => b.area_sqm - a.area_sqm

/**
 * Build a `{ count, sample }` payload: every offender counted, the first
 * {@link ERROR_LIST_SAMPLE_CAP} of them in `compare` order reported.
 *
 * @param {object[]} offenders payload rows, already in payload field shape
 * @param {(a: object, b: object) => number} compare
 * @returns {{ count: number, sample: object[] }}
 */
function listPayload(offenders, compare) {
  return {
    count: offenders.length,
    sample: [...offenders].sort(compare).slice(0, ERROR_LIST_SAMPLE_CAP)
  }
}

/** The three identity fields every per-feature offender row carries. */
function identity(feature) {
  return { idx: feature.idx, fid: feature.fid, feature_ref: feature.featureRef }
}

/**
 * Payload for the error codes that report nothing but *which* features
 * offended: HEDGEROWS_OUTSIDE_REDLINE, WATERCOURSES_OUTSIDE_REDLINE,
 * IGGIS_OUTSIDE_REDLINE, TREES_OUTSIDE_REDLINE.
 *
 * @param {import('./geometry.js').LoadedFeature[]} features
 */
export function featureListPayload(features) {
  return listPayload(features.map(identity), byIdx)
}

/**
 * Payload for AREA_PARCELS_INVALID_GEOMETRY — identity plus the GEOS validity
 * reason, which is the same string PostGIS surfaces from ST_IsValidDetail.
 *
 * @param {Array<{ feature: object, reason: string|null }>} offenders
 */
export function invalidGeometryPayload(offenders) {
  return listPayload(
    offenders.map(({ feature, reason }) => ({ ...identity(feature), reason })),
    byIdx
  )
}

/**
 * Payload for PARCEL_OVERLAPS — both halves of every offending pair.
 *
 * @param {Array<{ a: object, b: object }>} pairs
 */
export function overlapPayload(pairs) {
  return listPayload(
    pairs.map(({ a, b }) => ({
      idx_a: a.idx,
      fid_a: a.fid,
      feature_ref_a: a.featureRef,
      idx_b: b.idx,
      fid_b: b.fid,
      feature_ref_b: b.featureRef
    })),
    byPairIdx
  )
}

/**
 * Payload for AREA_PARCELS_TOO_SMALL — identity plus the parcel's own area, so
 * the message can say how small the offending shape actually is.
 *
 * @param {Array<{ feature: object, areaSqM: number }>} offenders
 */
export function tooSmallPayload(offenders) {
  return listPayload(
    offenders.map(({ feature, areaSqM }) => ({
      ...identity(feature),
      area_sqm: areaSqM
    })),
    byIdx
  )
}

/**
 * Payload for AREA_PARCELS_OUTSIDE_REDLINE — identity plus the area and
 * location of the part that escapes, so the parcel ref and the place on the map
 * appear on one line.
 *
 * @param {Array<{ feature: object, escapeAreaSqM: number, escapeWkt: string }>} offenders
 */
export function outsideRedlinePayload(offenders) {
  return listPayload(
    offenders.map(({ feature, escapeAreaSqM, escapeWkt }) => ({
      ...identity(feature),
      escape_area_sqm: escapeAreaSqM,
      escape_location_wkt: escapeWkt
    })),
    byIdx
  )
}

/**
 * Payload for SLIVERS_OUTSIDE_REDLINE — the escaping *pieces*, not the parcels
 * they came from, largest first.
 *
 * @param {Array<{ areaSqM: number, wkt: string }>} pieces
 */
export function sliverPayload(pieces) {
  return listPayload(
    pieces.map(({ areaSqM, wkt }) => ({
      area_sqm: areaSqM,
      location_wkt: wkt
    })),
    byAreaDescending
  )
}
