import {
  OVERLAY_GRID_SIZE_M,
  PARCEL_OUTSIDE_TOLERANCE_SQ_M
} from '../../geometry-constants.js'
import { toBritishNationalGrid } from '../../geos/reproject.js'

/**
 * Whether a post-intervention area habitat lies within the baseline parent it
 * names (BMD-1083). A row copied, pasted or split from its parent lies inside
 * it, so a row that does not names the wrong parent: the land it stands on
 * outside that parent would be counted lost from the parcel it belongs to,
 * and kept, or created, against the one it names.
 *
 * Measured as the red line's check of an area habitat outside it is
 * (geos/checks.js): the area of the row less its parent, on the fixed
 * overlay grid, must be no more than PARCEL_OUTSIDE_TOLERANCE_SQ_M. A split
 * part's edges lie on its parent's boundary, so an area, not a Boolean
 * predicate, keeps GEOS's wobble on shared vertices from refusing it. A
 * parent that covers the row outright is passed without the overlay.
 *
 * Only a Polygon or MultiPolygon is measured. A row or parent with no such
 * shape is taken to lie within: the geometry checks refuse a broken shape,
 * and this one only asks where a sound one lies.
 */

const POLYGONAL = new Set(['Polygon', 'MultiPolygon'])

/** A feature's polygonal shape in British National Grid, or null. */
function polygonalGeometry(feature) {
  const geometry = feature?.nativeGeometry
  if (!POLYGONAL.has(geometry?.type) || !Array.isArray(geometry.coordinates)) {
    return null
  }
  // Both stages come from one file, so a shape with no SRID is in the
  // other's: the template's layers are all in British National Grid.
  return feature.nativeSrid == null
    ? geometry
    : toBritishNationalGrid(geometry, feature.nativeSrid)
}

/** A shape as GEOS holds it, made valid, or null when there is none. */
function loadShape(runtime, geometry) {
  if (geometry === null) {
    return null
  }
  const raw = runtime.fromGeoJson(geometry)
  const valid = runtime.makeValid(raw)
  runtime.free(raw)
  return valid
}

/**
 * A check of rows against their parents for one file. Each parent's shape is
 * loaded and prepared once, however many rows name it; `free` releases them.
 *
 * @param {import('../../geos/geos-runtime.js').GeosRuntime} runtime
 * @returns {{
 *   liesWithinParent: (row: object, parent: object) => boolean,
 *   free: () => void
 * }}
 */
export function createWithinParentCheck(runtime) {
  const { geos } = runtime
  const parents = new Map()

  const parentShape = (parent) => {
    if (!parents.has(parent)) {
      const valid = loadShape(runtime, polygonalGeometry(parent))
      parents.set(
        parent,
        valid === null ? null : { valid, prepared: geos.GEOSPrepare(valid) }
      )
    }
    return parents.get(parent)
  }

  const outsideArea = (row, shape) => {
    if (geos.GEOSPreparedCovers(shape.prepared, row) === 1) {
      return 0
    }
    const outside = geos.GEOSDifferencePrec(
      row,
      shape.valid,
      OVERLAY_GRID_SIZE_M
    )
    const area = runtime.area(outside)
    runtime.free(outside)
    return area
  }

  return {
    liesWithinParent(row, parent) {
      const shape = parentShape(parent)
      const rowShape =
        shape === null ? null : loadShape(runtime, polygonalGeometry(row))
      if (rowShape === null) {
        return true
      }
      try {
        return outsideArea(rowShape, shape) <= PARCEL_OUTSIDE_TOLERANCE_SQ_M
      } finally {
        runtime.free(rowShape)
      }
    },
    free() {
      for (const shape of parents.values()) {
        if (shape !== null) {
          geos.GEOSPreparedGeom_destroy(shape.prepared)
          runtime.free(shape.valid)
        }
      }
      parents.clear()
    }
  }
}
