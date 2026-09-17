/**
 * OS basemap tiles, as a service — in two flavours from one key.
 *
 *   getGrid()                   the raster EPSG:27700 tile matrix set, from
 *                               OS's own WMTS capabilities
 *   getTile(z, col, row)        one raster PNG, cached ("OS Maps API")
 *   getVectorGrid()             the vector tiling scheme, from OS's published
 *                               TileMatrixSet JSON
 *   getVectorTile(z, col, row)  one Mapbox Vector Tile, cached
 *                               ("OS NGD API – Tiles", ngd-base tileset)
 *
 * The two flavours need DIFFERENT OS Data Hub products on the key, and a key
 * may hold either — which is why both exist and why the report route lets a
 * request choose (`?basemap=vector|raster`).
 *
 * Two consumers, one integration:
 *
 *   browser map ─┐
 *                ├─→ this service ─→ cache ─→ api.os.uk (via the CDP proxy)
 *   report PDF  ─┘        key injected here, once
 *
 * The report builder calls this **in process** rather than over HTTP. The spike
 * proved the round trip through the route is content-neutral, but making the
 * service call itself over the loopback for every one of a hundred-odd tiles
 * buys nothing and costs a request each. The Hapi route in
 * `src/plugins/os-tiles.js` is a thin shell over these same two functions, so
 * the browser and the PDF are served by identical code either way.
 *
 * Every failure is an `OsTileError` (see `errors.js`) carrying the `status`
 * it corresponds to, so both callers can distinguish OS's 401 (key or
 * product) from its 403 (plan) — see `upstream.js` — and tell a tile failure,
 * which a report degrades around, from a fault in the drawing, which it must
 * not hide.
 */

import { isTileInGrid } from '../report/pdf/grid.js'
import { OsTileError } from './errors.js'
import { keyWarning, resolveOsTilesConfig } from './config.js'
import {
  fetchGrid,
  fetchTile,
  fetchVectorGrid,
  fetchVectorTile
} from './upstream.js'

const HTTP_NOT_FOUND = 404

function tileKey({ layer, z, col, row }) {
  return `${layer}/${z}/${col}/${row}`
}

/**
 * What this service does without a cache: nothing, every time.
 *
 * Production always has one — the plugin provisions a catbox policy and
 * injects it (`plugins/os-tiles.js`), which is also how a Redis cache would
 * arrive, as provisioning rather than code. Constructing the service directly
 * without one is a test doing so deliberately, and it should get uncached
 * behaviour rather than a second, differently-behaved cache implementation
 * living here to serve that case.
 */
const NO_CACHE = Object.freeze({
  get: async () => null,
  set: async () => {}
})

/**
 * @param {object} options
 * @param {object} [options.config]     see resolveOsTilesConfig
 * @param {object} [options.cache]      get/set; without one, nothing is cached
 * @param {object} [options.logger]     console-compatible
 * @param {Function} [options.fetchImpl]
 */
function createOsTiles(options = {}) {
  const config = resolveOsTilesConfig(options.config)
  const logger = options.logger ?? console
  const fetchImpl = options.fetchImpl ?? fetch
  const cache = options.cache ?? NO_CACHE

  const warning = keyWarning(config)
  if (warning) {
    logger.warn?.(warning)
  }

  const deps = { config, logger, fetchImpl, cache }
  return {
    config,
    ...rasterTiles(deps),
    ...vectorTiles(deps)
  }
}

/**
 * The raster half: OS Maps API, 256 px PNG tiles, its own grid from OS's WMTS
 * capabilities.
 *
 * A factory of its own rather than lines inside `createOsTiles`, because the
 * two halves share nothing but the config and the cache — separate products,
 * separate grids, separate cache keyspaces — and read as two things.
 */
function rasterTiles({ config, logger, fetchImpl, cache }) {
  // Capabilities are fetched once and reused. The grid is static for the life
  // of the product, and every tile request needs it for bounds validation.
  let gridPromise = null

  function getGrid() {
    gridPromise ??= fetchGrid(config, fetchImpl).catch((error) => {
      gridPromise = null // let a transient failure be retried
      throw error
    })
    return gridPromise
  }

  /**
   * The grid as consumers should see it: with the effective `maxZoom` folded
   * in, so a caller picks a zoom it can actually fetch without knowing
   * anything about OS plans — the same reasoning that keeps the key out of it.
   */
  async function getPublishedGrid() {
    return { ...(await getGrid()), maxZoom: config.maxZoom }
  }

  async function getTile(z, col, row) {
    const grid = await getGrid()

    // Validate before going upstream. An unbounded index from a client must
    // never become an outbound request — that is how a proxy becomes an open
    // relay onto someone else's paid API, and how a cache fills with junk keys.
    if (!isTileInGrid(grid, z, col, row)) {
      throw notFound(
        `Tile ${z}/${col}/${row} is outside the ${config.layer} grid`
      )
    }

    // config.maxZoom is the stricter of the product's ceiling and the plan's
    // (OS_MAPS_MAX_ZOOM). Rejecting here rather than upstream turns what would
    // be a burst of opaque 403s into one local, explicable 404.
    if (z > config.maxZoom) {
      // The operator's half of this — that the fix is usually OS_MAPS_MAX_ZOOM
      // rather than a new key — goes to the log, not to the caller. A tile
      // route answers browsers; which environment variable this deployment
      // should change, and what OS plan it is on, are not theirs to know.
      logger.info?.(
        `OS tiles: zoom ${z} is above OS_MAPS_MAX_ZOOM (${config.maxZoom}) for ` +
          `${config.layer}. If this key is on a Premium/PSGA plan, raise or unset it.`
      )
      throw notFound(
        `Zoom ${z} exceeds the maximum zoom ${config.maxZoom} for this basemap`
      )
    }

    const key = tileKey({ layer: config.layer, z, col, row })
    const cached = await cache.get(key)
    if (cached) {
      return { png: cached, contentType: 'image/png', cached: true }
    }

    const { png, contentType } = await fetchTile(
      config,
      { z, col, row },
      fetchImpl
    )
    await cache.set(key, png)
    return { png, contentType, cached: false }
  }

  return { getGrid, getPublishedGrid, getTile }
}

/**
 * The vector half: OS NGD API – Tiles, the ngd-base tileset. A separate grid
 * (512 px tiles, two more levels than the raster one) and a separate cache
 * keyspace; the same validation.
 */
function vectorTiles({ config, fetchImpl, cache }) {
  let vectorGridPromise = null

  function getVectorGrid() {
    vectorGridPromise ??= fetchVectorGrid(config, fetchImpl).catch((error) => {
      vectorGridPromise = null // let a transient failure be retried
      throw error
    })
    return vectorGridPromise
  }

  async function getPublishedVectorGrid() {
    return { ...(await getVectorGrid()), maxZoom: config.vectorMaxZoom }
  }

  async function getVectorTile(z, col, row) {
    const grid = await getVectorGrid()

    if (!isTileInGrid(grid, z, col, row)) {
      throw notFound(`Tile ${z}/${col}/${row} is outside the ngd-base grid`)
    }

    if (z > config.vectorMaxZoom) {
      throw notFound(
        `Zoom ${z} exceeds max zoom ${config.vectorMaxZoom} for ngd-base — ` +
          'the tileset publishes zooms 0-15.'
      )
    }

    const key = tileKey({ layer: VECTOR_CACHE_LAYER, z, col, row })
    const cached = await cache.get(key)
    if (cached) {
      return { pbf: cached, contentType: VECTOR_CONTENT_TYPE, cached: true }
    }

    const { pbf, contentType } = await fetchVectorTile(
      config,
      { z, col, row },
      fetchImpl
    )
    await cache.set(key, pbf)
    return { pbf, contentType, cached: false }
  }

  return { getVectorGrid, getPublishedVectorGrid, getVectorTile }
}

/** Distinct from any raster layer name, so the two flavours never collide. */
const VECTOR_CACHE_LAYER = 'ngd-base-27700'
const VECTOR_CONTENT_TYPE = 'application/vnd.mapbox-vector-tile'

/**
 * A tile this service refused to ask OS for.
 *
 * Left unmarked as upstream: the message describes the coordinates the caller
 * asked for and the ceiling they crossed, so it is the one class of tile
 * failure that can be handed back verbatim.
 */
function notFound(message) {
  return new OsTileError(message, { status: HTTP_NOT_FOUND })
}

export { createOsTiles }
