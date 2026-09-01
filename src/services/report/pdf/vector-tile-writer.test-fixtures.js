/**
 * Writing Mapbox Vector Tiles — test support only.
 *
 * Nothing in production writes a vector tile: Ordnance Survey does that, and
 * `mvt.js` reads what arrives. This exists so the fixtures can serve synthetic
 * vector tiles (`synthetic-tiles.test-fixtures.js`) and so decode is proven by
 * round-trip rather than trusted by eye.
 *
 * `@maplibre/vt-pbf` does the encoding. It takes the object shape
 * `@mapbox/vector-tile` produces — lazy `layer.feature(i)` accessors returning
 * `{ type, properties, loadGeometry() }` — so the adapter below is the inverse
 * of `mvt.js`'s: plain data in, that shape out.
 */

import { fromVectorTileJs } from '@maplibre/vt-pbf'

import { DEFAULT_EXTENT, GEOMETRY_POLYGON } from './mvt.js'

const VECTOR_TILE_VERSION = 2

/**
 * Close a polygon ring by repeating its first vertex.
 *
 * The encoder writes `ring.length - 1` LineTo commands and then a ClosePath,
 * because it expects the closed rings `loadGeometry` produces. Handing it an
 * open ring silently drops the last real vertex — a square comes back a
 * triangle — so the ring is closed here and `decodeVectorTile` opens it again.
 * Round-trip is then the identity, which is what makes it a proof.
 */
function closeRing(ring) {
  const last = ring.length - 1
  const isClosed = ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
  return isClosed ? ring : [...ring, ring[0]]
}

/**
 * Present one plain `{ type, properties, paths }` feature the way
 * `@mapbox/vector-tile` would.
 */
function asVectorTileFeature(feature) {
  const paths =
    feature.type === GEOMETRY_POLYGON
      ? feature.paths.map(closeRing)
      : feature.paths
  return {
    type: feature.type,
    properties: feature.properties ?? {},
    extent: feature.extent ?? DEFAULT_EXTENT,
    loadGeometry() {
      return paths.map((path) => path.map(([x, y]) => ({ x, y })))
    }
  }
}

/**
 * Encode a tile.
 *
 * @param {Array<{name: string, extent?: number, features: Array<{type: number, properties?: object, paths: number[][][]}>}>} layers
 * @returns {Buffer}
 */
export function encodeVectorTile(layers) {
  const asTile = { layers: {} }
  for (const layer of layers) {
    const extent = layer.extent ?? DEFAULT_EXTENT
    asTile.layers[layer.name] = {
      version: VECTOR_TILE_VERSION,
      name: layer.name,
      extent,
      length: layer.features.length,
      feature: (index) =>
        asVectorTileFeature({ ...layer.features[index], extent })
    }
  }
  return Buffer.from(fromVectorTileJs(asTile))
}
