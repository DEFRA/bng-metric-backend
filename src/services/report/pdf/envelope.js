/**
 * Envelope helpers over GeoJSON in a projected CRS (EPSG:27700 metres).
 *
 * Deliberately small. Areas and lengths are NOT computed here: the project
 * document already carries `sizeSquareMetres` / `sizeMetres` for every feature,
 * and those are the numbers the rest of the service displays. Recomputing them
 * from the geometry would give the report a second opinion, and a report that
 * disagrees with the screen it was generated from is worse than no report.
 *
 * `@turf/bbox` does the coordinate walking — it handles every GeoJSON nesting
 * depth including GeometryCollection, which is what `envelopeOfAll` uses to
 * fold a whole layer into one call. Only turf's BOUNDING-BOX helpers are safe
 * in this coordinate system: `@turf/area` and the other measurement functions
 * are geodesic and assume WGS84 degrees, so on British National Grid metres
 * they return nonsense (a 100 m square measures 1.07e14 m²). A bounding box is
 * pure min/max over the coordinates and carries no such assumption.
 *
 * The site extent itself comes from PostGIS (`ST_Extent`); this is for the
 * per-parcel thumbnails, where asking the database for one bounding box per
 * parcel would be a round trip per row for arithmetic we can do on
 * coordinates already in memory.
 */

import { bbox } from '@turf/bbox'

/** An envelope is { minX, minY, maxX, maxY } in CRS units. */
function emptyEnvelope() {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  }
}

function isEmptyEnvelope(envelope) {
  return !(envelope.minX <= envelope.maxX && envelope.minY <= envelope.maxY)
}

function fromBbox([minX, minY, maxX, maxY]) {
  return { minX, minY, maxX, maxY }
}

/**
 * The envelope of one geometry, or an empty envelope if there is none.
 *
 * A feature with no geometry is dropped upstream (`site-data.js`), so a null
 * here means a caller has reached past that; an empty envelope keeps it a
 * missing thumbnail rather than a failed report.
 */
function envelopeOf(geometry) {
  return geometry ? fromBbox(bbox(geometry)) : emptyEnvelope()
}

/**
 * The envelope of many geometries at once.
 *
 * Wrapping them in a GeometryCollection is what lets one `bbox` call do the
 * whole layer: turf walks the collection's members like any other nesting,
 * and an empty collection yields the same infinities `emptyEnvelope` does.
 */
function envelopeOfAll(geometries) {
  return fromBbox(
    bbox({
      type: 'GeometryCollection',
      geometries: geometries.filter(Boolean)
    })
  )
}

/**
 * Grow an envelope by a fraction of its own size on every side.
 *
 * A degenerate envelope (a single point, or a perfectly straight line) has
 * zero extent on at least one axis, so a proportional pad would leave it
 * degenerate and the page transform would divide by zero. Those fall back to
 * a fixed metre pad.
 */
const DEGENERATE_PAD_METRES = 25

function padEnvelope(envelope, fraction) {
  const width = envelope.maxX - envelope.minX
  const height = envelope.maxY - envelope.minY
  const padX = width > 0 ? width * fraction : DEGENERATE_PAD_METRES
  const padY = height > 0 ? height * fraction : DEGENERATE_PAD_METRES
  return {
    minX: envelope.minX - padX,
    minY: envelope.minY - padY,
    maxX: envelope.maxX + padX,
    maxY: envelope.maxY + padY
  }
}

export {
  emptyEnvelope,
  envelopeOf,
  envelopeOfAll,
  isEmptyEnvelope,
  padEnvelope
}
