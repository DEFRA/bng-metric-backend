import * as turf from '@turf/turf'

/**
 * @typedef {import('geojson').Feature<import('geojson').Polygon | import('geojson').MultiPolygon>} PolygonFeature
 * @typedef {import('geojson').Polygon | import('geojson').MultiPolygon | import('geojson').Geometry} GeoJsonGeometry
 */

/**
 * Union a list of GeoJSON Features into a single Feature. Single-feature lists
 * are returned as-is to avoid unnecessary turf.union work. On failure, falls
 * back to the first feature so callers can still proceed with a containment
 * test rather than aborting the whole validation.
 *
 * @param {PolygonFeature[]} features
 * @returns {PolygonFeature | null} Unioned Feature, or null when input is empty
 */
export function unionFeatures(features) {
  if (!features || features.length === 0) {
    return null
  }
  if (features.length === 1) {
    return features[0]
  }
  try {
    return turf.union(turf.featureCollection(features))
  } catch {
    return features[0]
  }
}

/**
 * Compute the intersection of two GeoJSON Features, swallowing the
 * topology-exception that turf throws on degenerate input.
 *
 * @param {PolygonFeature} a
 * @param {PolygonFeature} b
 * @returns {PolygonFeature | null} Intersection Feature, or null when there is
 *   no intersection or the operation fails
 */
export function safeIntersect(a, b) {
  try {
    return turf.intersect(turf.featureCollection([a, b]))
  } catch {
    return null
  }
}

/**
 * Compute the union of a list of GeoJSON Features, returning null on failure
 * instead of throwing. Unlike unionFeatures, this does not short-circuit on
 * single-feature input — use it when you specifically want a turf.union call.
 *
 * @param {PolygonFeature[]} features
 * @returns {PolygonFeature | null} Unioned Feature, or null on failure
 */
export function safeUnion(features) {
  try {
    return turf.union(turf.featureCollection(features))
  } catch {
    return null
  }
}

/**
 * Compute the difference (a minus b) of two GeoJSON Features, returning null
 * on failure or when the result is empty.
 *
 * @param {PolygonFeature} a
 * @param {PolygonFeature} b
 * @returns {PolygonFeature | null} Difference Feature, or null when empty or on
 *   failure
 */
export function safeDifference(a, b) {
  try {
    return turf.difference(turf.featureCollection([a, b]))
  } catch {
    return null
  }
}

/**
 * Shoelace area of a single linear ring. Coordinates must be in metres.
 *
 * @param {number[][]} ring Array of [x, y] coordinate pairs, closed (first
 *   coordinate equal to last)
 * @returns {number} Area in square metres
 */
function ringArea(ring) {
  let sum = 0
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

/**
 * Sum of ring areas for a Polygon's coordinate array (outer ring minus holes).
 *
 * @param {number[][][]} rings Polygon coordinate array — first entry is the
 *   outer ring, subsequent entries are holes
 * @returns {number} Area in square metres
 */
function polygonArea(rings) {
  if (!rings || rings.length === 0) {
    return 0
  }
  let area = ringArea(rings[0])
  for (let i = 1; i < rings.length; i++) {
    area -= ringArea(rings[i])
  }
  return area
}

/**
 * Planar (shoelace) area of a GeoJSON Polygon or MultiPolygon. Coordinates
 * must already be in a projected CRS whose units are metres (e.g. EPSG:27700).
 * Used where turf.area's spherical approximation isn't precise enough.
 *
 * @param {GeoJsonGeometry | null | undefined} geometry
 * @returns {number} Area in square metres; 0 for null/unsupported geometry
 */
export function planarArea(geometry) {
  if (!geometry) {
    return 0
  }
  if (geometry.type === 'Polygon') {
    return polygonArea(geometry.coordinates)
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((acc, p) => acc + polygonArea(p), 0)
  }
  return 0
}
