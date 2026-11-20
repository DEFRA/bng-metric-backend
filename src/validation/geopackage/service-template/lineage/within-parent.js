import { toBritishNationalGrid } from '../../geos/reproject.js'

/**
 * Whether a post-intervention area habitat lies within the baseline parent it
 * names (BMD-1083). A row copied, pasted or split from its parent lies inside
 * it, so a row that does not names the wrong parent: the parcel it stands on
 * would be counted lost, and the one it names kept at a size it does not
 * have.
 *
 * One point inside each part of the row is tested, not every edge: a split
 * part's edges lie on its parent's boundary, where rounding would decide. The
 * point is the middle of the widest stretch of the part that a horizontal line
 * through its outer ring's centroid crosses, so it lies inside the part, clear
 * of its holes, even where the part is concave.
 *
 * A shape that cannot be read is taken to lie within: the geometry checks
 * refuse a broken shape, and this one only asks where a sound one lies.
 */

const CENTROID_DIVISOR = 3

/** A geometry's polygons, each a list of rings, in British National Grid. */
function polygonsOf(feature) {
  const geometry = feature?.nativeGeometry
  if (!geometry?.coordinates) {
    return []
  }
  // Both stages come from one file, so a shape with no SRID is in the
  // other's: the template's layers are all in British National Grid.
  const { type, coordinates } =
    feature.nativeSrid == null
      ? geometry
      : toBritishNationalGrid(geometry, feature.nativeSrid)
  if (type === 'Polygon') {
    return [coordinates]
  }
  return type === 'MultiPolygon' ? coordinates : []
}

/** The y of a closed ring's area-weighted centroid, or null when it has none. */
function centroidY(ring) {
  let cy = 0
  let twiceArea = 0
  for (let i = 1; i < ring.length; i += 1) {
    const [x1, y1] = ring[i - 1]
    const [x2, y2] = ring[i]
    const cross = x1 * y2 - x2 * y1
    twiceArea += cross
    cy += (y1 + y2) * cross
  }
  return twiceArea === 0 ? null : cy / (CENTROID_DIVISOR * twiceArea)
}

/** Where each ring's edges cross the horizontal line at `y`, in order. */
function crossingsAt(polygon, y) {
  const crossings = []
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      const [ax, ay] = ring[i - 1]
      const [bx, by] = ring[i]
      if (ay > y !== by > y) {
        crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
      }
    }
  }
  return crossings.sort((a, b) => a - b)
}

/** A point inside a polygon and clear of its holes, or null for a flat one. */
export function interiorPoint(polygon) {
  const y = centroidY(polygon[0] ?? [])
  if (y === null) {
    return null
  }
  const crossings = crossingsAt(polygon, y)
  let best = null
  for (let i = 1; i < crossings.length; i += 2) {
    const width = crossings[i] - crossings[i - 1]
    if (width > 0 && (best === null || width > best.width)) {
      best = { width, x: (crossings[i] + crossings[i - 1]) / 2 }
    }
  }
  return best === null ? null : [best.x, y]
}

/** Ray-casting point-in-ring test: true when the point is inside the ring. */
function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Whether a point is inside a polygon's outer ring and none of its holes. */
function inPolygon(point, [outer, ...holes]) {
  return (
    inRing(point, outer ?? []) && !holes.some((hole) => inRing(point, hole))
  )
}

/**
 * Whether every part of a post-intervention area habitat lies within the
 * baseline parent it names.
 *
 * @param {object} row a post-intervention feature, read with its geometry
 * @param {object} parent the baseline feature it names, read with its geometry
 * @returns {boolean}
 */
export function liesWithinParent(row, parent) {
  const parentPolygons = polygonsOf(parent)
  if (parentPolygons.length === 0) {
    return true
  }
  return polygonsOf(row).every((part) => {
    const point = interiorPoint(part)
    return (
      point === null ||
      parentPolygons.some((polygon) => inPolygon(point, polygon))
    )
  })
}
