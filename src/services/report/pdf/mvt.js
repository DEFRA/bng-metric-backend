/**
 * Mapbox Vector Tile decoding, in the shape the basemap drawer wants.
 *
 * The format work is `@mapbox/vector-tile` over `pbf` — the reference
 * implementation, and the same pair MapLibre itself decodes tiles with. This
 * module is only the adapter between it and `map.js`: it flattens the
 * library's lazy layer/feature accessors into plain data, and it normalises
 * the one thing the drawer cares about that the library leaves to the caller
 * (see "closing vertices" below).
 *
 * The spike this came from hand-rolled the protobuf reader to keep its
 * dependency count at one, and verified it byte-for-byte against this library
 * on a live 18-layer, 1,054-feature Ordnance Survey tile. That verification is
 * what made the swap safe rather than hopeful: the library is now the decoder,
 * and `mvt.test.js` pins the contract this adapter adds on top of it.
 *
 * Coordinates are TILE-LOCAL integers in [0, extent) (plus a buffer margin
 * outside it — real tiles include geometry slightly beyond their edge so
 * neighbours can draw seamlessly; the drawing side must clip). Converting them
 * to ground coordinates is the caller's job, because only the caller knows
 * which (z, col, row) square of Britain the tile covers.
 *
 * CLOSING VERTICES. `loadGeometry()` closes polygon rings for you, repeating
 * the first vertex at the end. `map.js` closes its own paths (`doc.closePath`),
 * so a repeated vertex would add a zero-length segment to every ring of every
 * basemap polygon — harmless to look at, wasteful in the content stream, and a
 * silent change to what the registration tests record. The ring is handed on
 * open, which is the contract the drawer was written against.
 */

import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'

export const GEOMETRY_POINT = 1
export const GEOMETRY_LINE = 2
export const GEOMETRY_POLYGON = 3
export const DEFAULT_EXTENT = 4096

function isSameVertex(a, b) {
  return a[0] === b[0] && a[1] === b[1]
}

/** Drop the repeated first vertex `loadGeometry` appends to a closed ring. */
function openRing(ring) {
  const last = ring.length - 1
  return last > 0 && isSameVertex(ring[0], ring[last])
    ? ring.slice(0, last)
    : ring
}

function pathsOf(feature) {
  const paths = feature
    .loadGeometry()
    .map((ring) => ring.map((point) => [point.x, point.y]))
  return feature.type === GEOMETRY_POLYGON ? paths.map(openRing) : paths
}

function readLayer(layer, name) {
  const features = []
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i)
    features.push({
      type: feature.type,
      properties: feature.properties,
      paths: pathsOf(feature)
    })
  }
  return { name, extent: layer.extent, features }
}

/**
 * Decode a whole tile.
 *
 * @param {Buffer} buffer
 * @returns {{ layers: Record<string, object> }} layers by name, each
 *   { name, extent, features: [{ type, properties, paths }] }
 */
export function decodeVectorTile(buffer) {
  const tile = new VectorTile(new PbfReader(buffer))
  const layers = {}
  for (const [name, layer] of Object.entries(tile.layers)) {
    layers[name] = readLayer(layer, name)
  }
  return { layers }
}
