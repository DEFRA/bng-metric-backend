import { ERROR_CODES, makeError } from '../errors.js'

// ---------------------------------------------------------------------------
// Per-feature description helpers
// ---------------------------------------------------------------------------

/**
 * Render a single offending feature (from `details.sample`) as a short label.
 * Prefers Feature Ref (the layer's per-feature reference column — Parcel Ref,
 * Tree Ref, or Baseline Parcel Ref, whichever is set), falls back to the fid,
 * then to the layer-relative position.
 *
 * @param {{ idx?: number, fid?: string|null, feature_ref?: string|null }} sample
 */
function describeFeature(sample) {
  if (sample?.feature_ref) {
    return `Feature Ref ${sample.feature_ref}`
  }
  if (sample?.fid != null && sample.fid !== '') {
    return `fid ${sample.fid}`
  }
  if (sample?.idx != null) {
    return `feature #${sample.idx}`
  }
  return 'feature'
}

/**
 * Render a "prefix: a, b, c (and N more)" message from a list-bearing
 * payload. Returns `prefix` unchanged when there are no offenders (defensive
 * — the SQL only emits a row when count > 0).
 *
 * @param {string} prefix
 * @param {{ count?: number, sample?: object[] }} payload
 * @param {(s: object) => string} [render]
 */
function formatList(prefix, payload, render = describeFeature) {
  const count = Number(payload?.count ?? 0)
  const sample = payload?.sample ?? []
  if (count === 0) {
    return prefix
  }
  const shown = sample.map(render).join(', ')
  if (count > sample.length) {
    return `${prefix}: ${shown} (and ${count - sample.length} more)`
  }
  return `${prefix}: ${shown}`
}

function describeOverlapPair(sample) {
  const a = describeFeature({
    idx: sample?.idx_a,
    fid: sample?.fid_a,
    feature_ref: sample?.feature_ref_a
  })
  const b = describeFeature({
    idx: sample?.idx_b,
    fid: sample?.fid_b,
    feature_ref: sample?.feature_ref_b
  })
  return `${a} ↔ ${b}`
}

function describeSliver(sample) {
  const area = Number(sample?.area_sqm ?? 0).toFixed(2)
  const loc = sample?.location_wkt ?? 'unknown location'
  return `~${area} sq m near ${loc}`
}

/**
 * Variant of describeFeature that also names the parcel's own area, so a
 * sliver report says how small the offending shape actually is.
 */
function describeFeatureWithArea(sample) {
  const base = describeFeature(sample)
  if (sample?.area_sqm == null) {
    return base
  }
  return `${base} — ~${Number(sample.area_sqm).toFixed(2)} sq m`
}

/**
 * Variant of describeFeature that also names the escape geometry's area + WKT
 * so the per-parcel report co-locates the parcel ref with where on the map it
 * leaks the redline.
 */
function describeFeatureWithEscape(sample) {
  const base = describeFeature(sample)
  if (sample?.escape_area_sqm == null || sample?.escape_location_wkt == null) {
    return base
  }
  const area = Number(sample.escape_area_sqm).toFixed(2)
  return `${base} — ~${area} sq m near ${sample.escape_location_wkt}`
}

function redlineInvalidGeometryMessage(payload) {
  if (!payload?.reason) {
    return 'Redline boundary geometry is invalid'
  }
  if (!payload.location_wkt) {
    return `Redline boundary geometry is invalid: ${payload.reason}`
  }
  return `Redline boundary geometry is invalid: ${payload.reason} at ${payload.location_wkt}`
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export const ERROR_BUILDERS = {
  [ERROR_CODES.NO_REDLINE]: () =>
    makeError(
      ERROR_CODES.NO_REDLINE,
      'Baseline file contains no redline boundary polygon'
    ),
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
  [ERROR_CODES.REDLINE_INVALID_GEOMETRY]: (p) =>
    makeError(
      ERROR_CODES.REDLINE_INVALID_GEOMETRY,
      redlineInvalidGeometryMessage(p)
    ),
  [ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY]: (p) =>
    makeError(
      ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY,
      formatList(
        'One or more area habitat polygons have invalid geometry',
        p,
        (s) => {
          const base = describeFeature(s)
          return s?.reason ? `${base} (${s.reason})` : base
        }
      ),
      p
    ),
  [ERROR_CODES.PARCEL_OVERLAPS]: (p) =>
    makeError(
      ERROR_CODES.PARCEL_OVERLAPS,
      formatList(
        'One or more area habitat parcels overlap with other parcels',
        p,
        describeOverlapPair
      ),
      p
    ),
  [ERROR_CODES.AREA_PARCELS_TOO_SMALL]: (p) =>
    makeError(
      ERROR_CODES.AREA_PARCELS_TOO_SMALL,
      formatList(
        'One or more area habitat parcels are slivers (smaller than 1 sq m)',
        p,
        describeFeatureWithArea
      ),
      p
    ),
  [ERROR_CODES.SLIVERS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
      formatList(
        'Baseline file contains habitat parcel parts outside the redline boundary',
        p,
        describeSliver
      ),
      p
    ),
  [ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
      formatList(
        'One or more area habitat polygons are not entirely within the redline boundary',
        p,
        describeFeatureWithEscape
      ),
      p
    ),
  [ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE,
      formatList(
        'One or more hedgerow habitats are not entirely within the redline boundary',
        p
      ),
      p
    ),
  [ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE,
      formatList(
        'One or more watercourse habitats are not entirely within the redline boundary',
        p
      ),
      p
    ),
  [ERROR_CODES.IGGIS_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.IGGIS_OUTSIDE_REDLINE,
      formatList(
        'One or more IGGIs are not entirely within the redline boundary',
        p
      ),
      p
    ),
  [ERROR_CODES.TREES_OUTSIDE_REDLINE]: (p) =>
    makeError(
      ERROR_CODES.TREES_OUTSIDE_REDLINE,
      formatList(
        'One or more trees are not entirely within the redline boundary',
        p
      ),
      p
    ),
  [ERROR_CODES.AREA_SUM_MISMATCH]: (p) =>
    makeError(
      ERROR_CODES.AREA_SUM_MISMATCH,
      `Sum of area habitat polygons (${Number(p.habitats_total).toFixed(2)} sq m) does not equal redline boundary area (${Number(p.redline_total).toFixed(2)} sq m)`
    )
}
