// Canonical geometry: the form in which two copies of one shape can be
// compared, whichever program wrote them. The drift check (baseline-drift.js)
// uses it to decide whether a baseline feature still has the shape its
// post-intervention children recorded in `parent_geom`.
//
// The two sides reach the backend by different routes:
//
//   * the baseline geometry is decoded from the GeoPackage's WKB at full
//     precision;
//   * `parent_geom` is WKT at 3 decimals, written by the template's Copy and
//     Refresh actions, its paste defaults, the converter or the generators.
//     QGIS writes mixed-case type names (`Polygon ((`), Python writers
//     uppercase ones (`POLYGON ((`), and a writer may use full precision.
//
// So neither side is compared as text or as raw numbers. Both go through the
// same recipe:
//
//   1. Round every x and y to 3 decimals (millimetres in EPSG:27700). Any Z or
//      M ordinate is dropped: drift is a planar question. Rounding BOTH sides
//      matters, because canonicalisation (step 3) tests distances against a
//      1 mm tolerance, and a vertex that rounding moves across that tolerance
//      would otherwise survive on one side and be stripped on the other.
//   2. Normalise a single-part Multi* geometry to its single type, so a
//      MultiPolygon of one part equals the Polygon it contains.
//   3. Canonicalise the coordinates: remove duplicate vertices (< 1 mm apart)
//      and collinear vertices (< 1 mm off the line through their neighbours).
//      QGIS topological editing inserts collinear vertices into a shared edge
//      while a neighbour is sliced, which changes the parent's vertex list but
//      not its shape.
//
// Two canonical geometries match when they have the same type and structure
// and every coordinate differs by at most MATCH_TOLERANCE_M. Vertex order is
// significant: `parent_geom` is the stored geometry as it was, not a
// normalised copy.
//
// The current baseline geometry has a second canonical form, in which step 3
// also runs once at full precision, before step 1. A vertex that topological
// editing inserts on an edge lies on that edge at full precision. Rounding
// moves it and the edge's two ends by up to 0.707 mm each, so after rounding
// it can sit up to 1.41 mm off the rounded edge, past the 1 mm tolerance,
// and survive. Stripping it at full precision first removes it. A recorded
// shape matches the current geometry when it matches either form
// (baseline-drift.js tries the second form only when the first fails).

import { parseWkt } from './parse-wkt.js'

/** Decimal places both sides are rounded to: millimetres in EPSG:27700. */
export const COORD_DECIMALS = 3

/**
 * Metres. The largest difference between two rounded coordinates that still
 * counts as the same position. Writers round an exact binary midpoint in
 * different directions (Python's `%.3f` to even, JavaScript's `toFixed` away
 * from zero), which moves a coordinate by exactly 0.001; the extra 0.0001
 * absorbs floating-point error in the subtraction.
 */
export const MATCH_TOLERANCE_M = 0.0011

// Metres. Vertices closer than this to each other are duplicates; vertices
// closer than this to the line through their neighbours are collinear.
const VERTEX_TOLERANCE = 0.001
const MIN_OPEN_PATH_VERTICES = 2
const MIN_RING_VERTICES = 3

/** Ordinates kept per position: x and y. */
const PLANAR_ORDINATES = 2

/** Array depth of a single position inside `coordinates`, per geometry type. */
const POSITION_DEPTH = Object.freeze({
  POINT: 0,
  MULTIPOINT: 1,
  LINESTRING: 1,
  MULTILINESTRING: 2,
  POLYGON: 2,
  MULTIPOLYGON: 3
})

/** The single type a one-part Multi* geometry is normalised to. */
const SINGLE_PART_TYPE = Object.freeze({
  MULTIPOINT: 'POINT',
  MULTILINESTRING: 'LINESTRING',
  MULTIPOLYGON: 'POLYGON'
})

function distance(p, q) {
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}

/** Perpendicular distance from point p to the infinite line through a–b. */
function perpendicularDistance(p, a, b) {
  const segmentLength = distance(a, b)
  if (segmentLength < VERTEX_TOLERANCE) {
    return 0 // degenerate segment counts as collinear
  }
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  return Math.abs(cross) / segmentLength
}

function samePosition(p, q) {
  return p[0] === q[0] && p[1] === q[1]
}

/** Keep the first vertex of every run of vertices within tolerance. */
function dedupeRuns(points) {
  const out = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    if (distance(points[i], out[out.length - 1]) >= VERTEX_TOLERANCE) {
      out.push(points[i])
    }
  }
  return out
}

/**
 * Dedupe an open path, preserving both endpoints: if the original final
 * vertex fell inside the tolerance of the last kept vertex (and is not that
 * exact position already), it replaces it, so the canonical path still ends
 * exactly where the original ended.
 */
function dedupeOpenPath(points) {
  const out = dedupeRuns(points)
  const finalPoint = points[points.length - 1]
  if (!samePosition(out[out.length - 1], finalPoint)) {
    out[out.length - 1] = finalPoint
  }
  return out
}

/**
 * Stack pass: drop any vertex that sits within tolerance of the line through
 * its surviving neighbours. The first and last vertices always survive.
 */
function stripCollinear(points) {
  const result = []
  for (const vertex of points) {
    while (
      result.length >= MIN_OPEN_PATH_VERTICES &&
      perpendicularDistance(
        result[result.length - 1],
        result[result.length - 2],
        vertex
      ) < VERTEX_TOLERANCE
    ) {
      result.pop()
    }
    result.push(vertex)
  }
  return result
}

function canonicaliseOpenPath(points) {
  if (points.length < MIN_OPEN_PATH_VERTICES) {
    return points
  }
  const deduped = dedupeOpenPath(points)
  const stripped = stripCollinear(deduped)
  if (stripped.length < MIN_OPEN_PATH_VERTICES) {
    return deduped
  }
  return stripped
}

/**
 * The interior strip treats the ring as an open path, so its first and last
 * vertices never face the collinearity test across the closing junction.
 * Re-test around that junction until a full pass removes nothing (bounded by
 * the original vertex count). Mutates and returns `pts`.
 */
function stripRingJunction(pts, maxIterations) {
  for (let i = 0; i < maxIterations; i += 1) {
    const last = pts.length - 1
    if (
      pts.length > MIN_RING_VERTICES &&
      perpendicularDistance(pts[0], pts[last], pts[1]) < VERTEX_TOLERANCE
    ) {
      pts.shift()
      continue
    }
    if (
      pts.length > MIN_RING_VERTICES &&
      perpendicularDistance(pts[last], pts[last - 1], pts[0]) < VERTEX_TOLERANCE
    ) {
      pts.pop()
      continue
    }
    break
  }
  return pts
}

/** Dedupe the open form of a ring, then drop a last vertex that has crept within tolerance of the first. */
function dedupeRing(openRing) {
  const deduped = dedupeRuns(openRing)
  if (
    deduped.length > 1 &&
    distance(deduped[0], deduped[deduped.length - 1]) < VERTEX_TOLERANCE
  ) {
    deduped.pop()
  }
  return deduped
}

function closeRing(pts) {
  return [...pts, [...pts[0]]]
}

function canonicaliseRing(ring) {
  if (ring.length < MIN_RING_VERTICES) {
    return ring
  }
  const openRing = ring.slice(0, -1) // drop the closing vertex
  const deduped = dedupeRing(openRing)
  const stripped = stripRingJunction(stripCollinear(deduped), ring.length)
  const pts = stripped.length < MIN_RING_VERTICES ? deduped : stripped
  return closeRing(pts)
}

function canonicalisePolygon(rings) {
  return rings.map((ring) => canonicaliseRing(ring))
}

const CANONICALISERS = {
  LINESTRING: canonicaliseOpenPath,
  MULTILINESTRING: (lines) => lines.map((line) => canonicaliseOpenPath(line)),
  POLYGON: canonicalisePolygon,
  MULTIPOLYGON: (polygons) =>
    polygons.map((rings) => canonicalisePolygon(rings))
}

/**
 * Shape-preserving canonicalisation of GeoJSON coordinates: removes duplicate
 * (< 1 mm apart) and collinear vertices — the vertex noise QGIS topological
 * editing introduces. Point/MultiPoint (and unknown types) pass through
 * unchanged. Never mutates the input; the result may share vertex arrays
 * with it.
 *
 * @param {string} type GeoJSON geometry type
 * @param {unknown[]} coordinates
 * @returns {unknown[]}
 */
export function canonicaliseCoordinates(type, coordinates) {
  const canonicalise = CANONICALISERS[type.toUpperCase()]
  if (!canonicalise) {
    return coordinates
  }
  return canonicalise(coordinates)
}

function isPosition(node) {
  return (
    Array.isArray(node) &&
    node.length >= PLANAR_ORDINATES &&
    Number.isFinite(node[0]) &&
    Number.isFinite(node[1])
  )
}

/**
 * True when `node` holds positions at exactly `depth` levels down and no
 * level is empty. Rejects EMPTY geometry, a wrong nesting for the type, and
 * non-finite ordinates (an exponent such as `1e999` reads as Infinity).
 */
function hasPositionsAtDepth(node, depth) {
  if (depth === 0) {
    return isPosition(node)
  }
  return (
    Array.isArray(node) &&
    node.length > 0 &&
    node.every((child) => hasPositionsAtDepth(child, depth - 1))
  )
}

function roundOrdinate(value) {
  return Number(value.toFixed(COORD_DECIMALS))
}

/**
 * Round every position to 3 decimals and keep only x and y. Returns new
 * arrays; the input is never mutated.
 *
 * @param {unknown[]} node GeoJSON coordinates at any depth
 * @returns {unknown[]}
 */
export function roundCoordinates(node) {
  if (typeof node[0] === 'number') {
    return node.slice(0, PLANAR_ORDINATES).map(roundOrdinate)
  }
  return node.map((child) => roundCoordinates(child))
}

/**
 * True when a GeoJSON geometry can be compared: a supported type with
 * well-formed, non-empty, finite coordinates.
 *
 * @param {{ type: string, coordinates: unknown[] } | null | undefined} geometry
 * @returns {boolean}
 */
function isComparable(geometry) {
  if (typeof geometry?.type !== 'string') {
    return false
  }
  const depth = POSITION_DEPTH[geometry.type.toUpperCase()]
  return depth !== undefined && hasPositionsAtDepth(geometry.coordinates, depth)
}

/**
 * Canonical form of a GeoJSON geometry, or null when it cannot be compared:
 * missing, EMPTY, an unsupported type (curves, collections) or malformed
 * coordinates.
 *
 * @param {{ type: string, coordinates: unknown[] } | null | undefined} geometry
 * @returns {{ type: string, coordinates: unknown[] } | null}
 */
export function canonicalGeometry(geometry) {
  if (!isComparable(geometry)) {
    return null
  }
  const parsedType = geometry.type.toUpperCase()
  const rounded = roundCoordinates(geometry.coordinates)
  const singleType = SINGLE_PART_TYPE[parsedType]
  const isSinglePart = singleType !== undefined && rounded.length === 1
  const type = isSinglePart ? singleType : parsedType
  const coordinates = isSinglePart ? rounded[0] : rounded
  return { type, coordinates: canonicaliseCoordinates(type, coordinates) }
}

/**
 * The second canonical form of a full-precision geometry: its duplicate and
 * collinear vertices are stripped before it is rounded, then it goes through
 * canonicalGeometry. This removes a vertex that topological editing inserted
 * on an edge even where rounding would push it more than 1 mm off the
 * rounded edge. Null when the geometry cannot be compared.
 *
 * @param {{ type: string, coordinates: unknown[] } | null | undefined} geometry
 * @returns {{ type: string, coordinates: unknown[] } | null}
 */
export function canonicalGeometryStrippedFirst(geometry) {
  if (!isComparable(geometry)) {
    return null
  }
  return canonicalGeometry({
    type: geometry.type,
    coordinates: canonicaliseCoordinates(geometry.type, geometry.coordinates)
  })
}

/**
 * Parse WKT into GeoJSON, or null when it is blank or cannot be parsed. Type
 * names are read in any case: QGIS writes `Polygon`, `LineString` and
 * `Point`, the Python writers `POLYGON`. The reader (parse-wkt.js) runs in
 * linear time, because `parent_geom` is text from the uploaded file.
 *
 * @param {unknown} wkt
 * @returns {{ type: string, coordinates: unknown[] } | null}
 */
export function geometryFromWkt(wkt) {
  if (typeof wkt !== 'string' || wkt.trim() === '') {
    return null
  }
  return parseWkt(wkt)
}

/**
 * Canonical form of a WKT geometry, or null when it cannot be compared.
 *
 * @param {unknown} wkt
 * @returns {{ type: string, coordinates: unknown[] } | null}
 */
export function canonicalGeometryFromWkt(wkt) {
  return canonicalGeometry(geometryFromWkt(wkt))
}

function coordinatesMatch(a, b) {
  if (!Array.isArray(b) || a.length !== b.length) {
    return false
  }
  if (typeof a[0] === 'number') {
    return a.every(
      (value, index) => Math.abs(value - b[index]) <= MATCH_TOLERANCE_M
    )
  }
  return a.every((child, index) => coordinatesMatch(child, b[index]))
}

/**
 * True when two canonical geometries are the same shape: same type, same
 * structure, and every coordinate within MATCH_TOLERANCE_M. Null on either
 * side never matches.
 *
 * @param {{ type: string, coordinates: unknown[] } | null} a
 * @param {{ type: string, coordinates: unknown[] } | null} b
 * @returns {boolean}
 */
export function canonicalGeometriesMatch(a, b) {
  if (!a || !b || a.type !== b.type) {
    return false
  }
  return coordinatesMatch(a.coordinates, b.coordinates)
}
