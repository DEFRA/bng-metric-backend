/**
 * Basemap tile sources for the report.
 *
 * One interface — `(grid, z, col, row) => Promise<{ png: Buffer }>` — with two
 * production callers' worth of behaviour behind it:
 *
 *  - `osTileSource(osTiles)` serves tiles from the OS tiles service, which is
 *    the only thing that holds an API key.
 *  - no tile source at all (`null`) means no basemap. That is the default, and
 *    it is a licensing position rather than a technical one: OS have not yet
 *    been asked whether we may embed their mapping in a PDF, which is a
 *    different question from displaying it in a browser because a PDF is
 *    redistributable. Until that is answered the report renders the geometry
 *    on a plain ground, which needs no permission from anybody.
 *
 * The tests add a third — a synthetic basemap whose tiles state where they
 * are — so registration can be proved offline. See
 * `synthetic-tiles.test-fixtures.js`.
 */

import { decodeVectorTile } from './mvt.js'
import { OsTileError } from '../../os-tiles/errors.js'

/**
 * Tiles from the OS tiles service, memoised for the life of one document.
 *
 * The service has its own cache; this second, tiny one exists because a single
 * report asks for the same tile many times over (neighbouring parcels overlap),
 * and there is no reason to round-trip an async cache for an answer already in
 * hand.
 */
function osTileSource(osTiles) {
  const seen = new Map()

  return async function fromOsTiles(_grid, z, col, row) {
    const key = `${z}/${col}/${row}`
    if (!seen.has(key)) {
      seen.set(
        key,
        osTiles.getTile(z, col, row).then(({ png }) => ({ png }))
      )
    }
    return seen.get(key)
  }
}

/**
 * Vector tiles from the same service, decoded here so downstream code holds
 * geometry, not bytes.
 *
 * Returns `{ layers }` (see decodeVectorTile) where the raster source returns
 * `{ png }` — that shape difference is how drawBasemap knows which kind of
 * tile it was handed. Memoising the DECODED tile matters more than for
 * raster: a dense tile decodes to a thousand-odd features, and thumbnails ask
 * for the same tile dozens of times.
 */
function osVectorTileSource(osTiles) {
  const seen = new Map()

  return async function fromOsVectorTiles(_grid, z, col, row) {
    const key = `${z}/${col}/${row}`
    if (!seen.has(key)) {
      seen.set(
        key,
        osTiles.getVectorTile(z, col, row).then(({ pbf }) => decode(pbf, key))
      )
    }
    return seen.get(key)
  }
}

/**
 * A tile that arrived but could not be read.
 *
 * Reported as an OsTileError, like a tile that never arrived: a malformed
 * payload from OS is a basemap failure, and the report degrades around it
 * rather than failing over a picture (see `build-site-report.js`). Wrapping
 * it here is what keeps that decision in one place — the alternative is a
 * `TypeError` from the middle of a protobuf reader arriving at the builder
 * looking exactly like a fault in the drawing.
 */
function decode(pbf, key) {
  try {
    return decodeVectorTile(pbf)
  } catch (error) {
    throw new OsTileError(`Could not decode the vector tile at ${key}`, {
      upstream: true,
      cause: error
    })
  }
}

export { osTileSource, osVectorTileSource }
