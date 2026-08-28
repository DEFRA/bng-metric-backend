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
 * Errors carry `status` so both callers can distinguish OS's 401 (key or
 * product) from its 403 (plan) — see `upstream.js`.
 */

import { isTileInGrid } from '../report/pdf/grid.js'
import { memoryTileCache, tileKey } from './cache.js'
import { keyWarning, resolveOsTilesConfig } from './config.js'
import {
  fetchGrid,
  fetchTile,
  fetchVectorGrid,
  fetchVectorTile
} from './upstream.js'

const HTTP_NOT_FOUND = 404

/**
 * @param {object} options
 * @param {object} [options.config]     see resolveOsTilesConfig
 * @param {object} [options.cache]      get/set; defaults to an in-process cache
 * @param {object} [options.logger]     console-compatible
 * @param {Function} [options.fetchImpl]
 */
function createOsTiles(options = {}) {
  const config = resolveOsTilesConfig(options.config)
  const logger = options.logger ?? console
  const fetchImpl = options.fetchImpl ?? fetch
  const cache =
    options.cache ??
    memoryTileCache({
      maxEntries: config.cacheMaxEntries,
      ttlSeconds: config.cacheTtlSeconds
    })

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
      throw notFound(
        `Zoom ${z} exceeds max zoom ${config.maxZoom} for ${config.layer}. ` +
          'If this key is on a Premium/PSGA plan, raise or unset OS_MAPS_MAX_ZOOM.'
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

  /**
   * The vector flavour: the same service against the OS NGD API – Tiles
   * ngd-base tileset. A separate grid (512 px tiles, two more levels than
   * the raster one) and a separate cache keyspace; the same validation.
   */
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

  const warning = keyWarning(config)
  if (warning) {
    logger.warn?.(warning)
  }

  return {
    config,
    cache,
    getGrid,
    getPublishedGrid,
    getTile,
    getVectorGrid,
    getPublishedVectorGrid,
    getVectorTile
  }
}

/** Distinct from any raster layer name, so the two flavours never collide. */
const VECTOR_CACHE_LAYER = 'ngd-base-27700'
const VECTOR_CONTENT_TYPE = 'application/vnd.mapbox-vector-tile'

function notFound(message) {
  const error = new Error(message)
  error.status = HTTP_NOT_FOUND
  return error
}

export { createOsTiles }
