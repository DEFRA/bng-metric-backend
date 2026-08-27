/**
 * Envelope helpers over GeoJSON in a projected CRS (EPSG:27700 metres).
 *
 * Deliberately small. Areas and lengths are NOT computed here: the project
 * document already carries `sizeSquareMetres` / `sizeMetres` for every feature,
 * and those are the numbers the rest of the service displays. Recomputing them
 * from the geometry would give the report a second opinion, and a report that
 * disagrees with the screen it was generated from is worse than no report.
 *
 * What is left is envelope walking, which nothing else provides in this shape:
 * the site extent comes from PostGIS (`ST_Extent`), but each parcel thumbnail
 * needs its own extent, and asking the database for one bounding box per parcel
 * is a round trip per row for arithmetic we can do on coordinates already in
 * memory.
 */

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

function extendEnvelope(envelope, [x, y]) {
  if (x < envelope.minX) {
    envelope.minX = x
  }
  if (x > envelope.maxX) {
    envelope.maxX = x
  }
  if (y < envelope.minY) {
    envelope.minY = y
  }
  if (y > envelope.maxY) {
    envelope.maxY = y
  }
  return envelope
}

/**
 * Walk every coordinate pair of any GeoJSON geometry, whatever its nesting
 * depth, and hand each one to `visit`.
 */
function forEachCoordinate(geometry, visit) {
  if (!geometry) {
    return
  }
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) {
      forEachCoordinate(child, visit)
    }
    return
  }
  walkCoordinates(geometry.coordinates, visit)
}

// A coordinate is a [number, number]; anything else is a list of them.
function walkCoordinates(node, visit) {
  if (typeof node?.[0] === 'number') {
    visit(node)
    return
  }
  for (const child of node ?? []) {
    walkCoordinates(child, visit)
  }
}

function envelopeOf(geometry) {
  const envelope = emptyEnvelope()
  forEachCoordinate(geometry, (coordinate) =>
    extendEnvelope(envelope, coordinate)
  )
  return envelope
}

function envelopeOfAll(geometries) {
  const envelope = emptyEnvelope()
  for (const geometry of geometries) {
    forEachCoordinate(geometry, (coordinate) =>
      extendEnvelope(envelope, coordinate)
    )
  }
  return envelope
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
  extendEnvelope,
  forEachCoordinate,
  isEmptyEnvelope,
  padEnvelope
}
