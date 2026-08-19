// Canonical geometry checksum — the cross-language contract with the QGIS
// template's copy action (see the workspace note
// `lineage-uuid-reconciliation.md`). The template stamps
// `parent_checksum` = checksum(parent geometry) at copy time; this module must
// reproduce that value byte-for-byte from the geometry the backend reads, so
// a mismatch means the baseline genuinely changed after the copy.
//
// Recipe (identical in the template's Python):
//
//   1. Canonicalise the coordinates (duplicate + collinear vertex removal,
//      below) — inside the checksum only; the stored geometry is untouched.
//   2. canonical = TYPE_UPPERCASE + "|" + ser(coordinates)
//        ser(leaf position) = numbers formatted to 3 decimals, joined ","
//        ser(nested array)  = "(" + children joined ";" + ")"
//   3. checksum = first 16 hex chars of sha256(canonical)
//
// Canonicalisation exists because QGIS topological editing inserts collinear
// vertices into coincident geometries while slicing neighbours: the parent's
// bytes change while its shape does not, which would otherwise raise a false
// drift warning. It is the identity on geometry that has no duplicate or
// collinear vertices, so checksums of clean geometry are unchanged.
//
// 3 decimals = millimetres in EPSG:27700, so representation noise between the
// two GeoJSON serialisers cannot manufacture a false drift. Rounding-tie
// divergence between Python's %.3f (half-even) and toFixed (half-away) needs
// an exact binary midpoint and real survey coordinates never sit on one; the
// worst case is a spurious warning, never an error.

import { createHash } from 'node:crypto'

const COORD_DECIMALS = 3
const CHECKSUM_HEX_LENGTH = 16

// Metres. Vertices closer than this to each other are duplicates; vertices
// closer than this to the line through their neighbours are collinear. Sits
// below the 3-decimal rounding above, so canonicalisation never merges
// vertices the serialiser would have kept apart.
const VERTEX_TOLERANCE = 0.001
const MIN_OPEN_PATH_VERTICES = 2
const MIN_RING_VERTICES = 3

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
 * (< 1 mm apart) and collinear vertices — the byte noise QGIS topological
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

function serialise(node) {
  if (typeof node[0] === 'number') {
    return node.map((value) => value.toFixed(COORD_DECIMALS)).join(',')
  }
  return `(${node.map((child) => serialise(child)).join(';')})`
}

/**
 * Checksum of a GeoJSON geometry, or null when there is nothing to hash.
 *
 * @param {{ type: string, coordinates: unknown[] } | null | undefined} geometry
 * @returns {string | null}
 */
export function geometryChecksum(geometry) {
  if (!geometry?.type || !Array.isArray(geometry.coordinates)) {
    return null
  }
  const canonical = canonicaliseCoordinates(geometry.type, geometry.coordinates)
  const payload = `${geometry.type.toUpperCase()}|${serialise(canonical)}`
  return createHash('sha256')
    .update(payload, 'utf8')
    .digest('hex')
    .slice(0, CHECKSUM_HEX_LENGTH)
}
