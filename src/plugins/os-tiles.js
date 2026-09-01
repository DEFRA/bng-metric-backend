/**
 * The OS tiles routes, and the service both they and the report builder use.
 *
 *   GET /os-tiles/capabilities                the raster EPSG:27700 grid, as JSON
 *   GET /os-tiles/{z}/{col}/{row}.png         one raster tile (OS Maps API)
 *   GET /os-tiles/vector/capabilities         the vector tiling scheme, as JSON
 *   GET /os-tiles/vector/{z}/{col}/{row}.pbf  one vector tile (NGD ngd-base)
 *
 * Registered ONLY when an OS Maps key is configured. Without a key every tile
 * would 401 from Ordnance Survey, so publishing the routes would mean
 * advertising an endpoint that cannot work; this way the absence of a key is
 * visible as the absence of a route. It also keeps the default deployment —
 * and CI — free of an integration that has an open licensing question against
 * it (see BMD-984), without a second feature flag to forget about.
 *
 * The routes deliberately do NOT set `auth: false`. This service is secure by
 * default (see docs/auth-route-policy.md), so they inherit `defra-jwt` and a
 * browser map reaches them through the frontend, which holds the user's
 * session and attaches the bearer token server-side. An unauthenticated tile
 * route is an open relay onto a paid API.
 *
 * Why the service is also hung on `server.app`: the report builder needs tiles
 * too, and calling our own HTTP route over the loopback for each of a hundred-
 * odd tiles would buy nothing. Both paths run the same two functions.
 */

import { Engine as CatboxMemory } from '@hapi/catbox-memory'

import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { createOsTiles } from '../services/os-tiles/index.js'

const logger = createLogger()

const HTTP_BAD_GATEWAY = 502

function maxZoomFromConfig() {
  const configured = config.get('osMaps.maxZoom')
  if (configured === '') {
    return null
  }
  const parsed = Number(configured)
  return Number.isInteger(parsed) ? parsed : null
}

function osTilesConfig() {
  return {
    apiKey: config.get('osMaps.apiKey'),
    layer: config.get('osMaps.layer'),
    maxZoom: maxZoomFromConfig(),
    cacheTtlSeconds: config.get('osMaps.cacheTtlSeconds'),
    cacheMaxBytes: config.get('osMaps.cacheMaxBytes')
  }
}

const CACHE_NAME = 'os-tiles'
const CACHE_SEGMENT = 'tiles'
const MS_PER_SECOND = 1000

/**
 * The tile cache: hapi's own, provisioned here rather than written here.
 *
 * Caching matters more for a generated PDF than for a browser map. A browser
 * user pans once and their own browser caches the result; a report re-fetches
 * the same site's tiles on every download. One site map is ~30 tiles, and the
 * per-parcel thumbnails push that well past 100 on a large site, most of them
 * repeats because neighbouring parcels overlap.
 *
 * A dedicated catbox client rather than the server's default cache, so the
 * tiles' byte budget and TTL are its own and a busy report cannot evict
 * whatever else the service caches later. catbox's `get`/`set` IS the
 * interface the service wants, so the policy is passed straight in.
 *
 * Process-local is a deliberate starting point: this service has no Redis (the
 * frontend has `ioredis` + `catbox-redis`; this side has neither). Per-instance
 * caching already collapses the repeats *within* a single report, which is
 * where the bulk of the duplication is. Cross-instance reuse, if it turns out
 * to matter, is then a provisioning change — swap the provider for
 * `@hapi/catbox-redis` — rather than a code change.
 */
async function provisionTileCache(server, { cacheTtlSeconds, cacheMaxBytes }) {
  await server.cache.provision({
    name: CACHE_NAME,
    provider: {
      constructor: CatboxMemory,
      options: { maxByteSize: cacheMaxBytes }
    }
  })

  return server.cache({
    cache: CACHE_NAME,
    segment: CACHE_SEGMENT,
    expiresIn: cacheTtlSeconds * MS_PER_SECOND
  })
}

function errorResponse(h, what, error) {
  logger.error(`OS tiles ${what} failed: ${error.message}`)
  return h
    .response({ error: error.message })
    .code(error.status ?? HTTP_BAD_GATEWAY)
}

const osTiles = {
  plugin: {
    name: 'os-tiles',
    version: '1.0.0',
    /**
     * `options` exists so the two injectable seams the service already has —
     * the upstream `fetch` and the cache — stay reachable from outside. Tests
     * use the first; the second lets a caller substitute the catbox policy
     * provisioned below.
     */
    async register(server, options = {}) {
      const tilesConfig = osTilesConfig()
      const service = createOsTiles({
        config: tilesConfig,
        logger,
        fetchImpl: options.fetchImpl,
        cache: options.cache ?? (await provisionTileCache(server, tilesConfig))
      })
      server.app.osTiles = service

      server.route([
        {
          method: 'GET',
          path: '/os-tiles/capabilities',
          handler: async (_request, h) => {
            try {
              return h.response({
                layer: service.config.layer,
                grid: await service.getPublishedGrid()
              })
            } catch (error) {
              return errorResponse(h, 'capabilities', error)
            }
          }
        },
        {
          method: 'GET',
          // `.png` is part of the path so the route cannot collide with
          // `/capabilities`, and so browsers and CDNs see a file extension.
          path: '/os-tiles/{z}/{col}/{row}.png',
          handler: async (request, h) => {
            const { z, col, row } = request.params
            try {
              const tile = await service.getTile(
                Number(z),
                Number(col),
                Number(row)
              )
              return h
                .response(tile.png)
                .type(tile.contentType)
                .header('x-tile-cache', tile.cached ? 'hit' : 'miss')
            } catch (error) {
              return errorResponse(h, `tile ${z}/${col}/${row}`, error)
            }
          }
        },
        // The vector flavour: same service, the OS NGD API – Tiles ngd-base
        // tileset upstream. `/vector` in the path keeps the two capability
        // documents distinct — their grids differ (512 px tiles against 256,
        // and a deeper zoom range).
        {
          method: 'GET',
          path: '/os-tiles/vector/capabilities',
          handler: async (_request, h) => {
            try {
              return h.response({
                layer: 'ngd-base',
                grid: await service.getPublishedVectorGrid()
              })
            } catch (error) {
              return errorResponse(h, 'vector capabilities', error)
            }
          }
        },
        {
          method: 'GET',
          path: '/os-tiles/vector/{z}/{col}/{row}.pbf',
          handler: async (request, h) => {
            const { z, col, row } = request.params
            try {
              const tile = await service.getVectorTile(
                Number(z),
                Number(col),
                Number(row)
              )
              return h
                .response(tile.pbf)
                .type(tile.contentType)
                .header('x-tile-cache', tile.cached ? 'hit' : 'miss')
            } catch (error) {
              return errorResponse(h, `vector tile ${z}/${col}/${row}`, error)
            }
          }
        }
      ])
    }
  }
}

/** Whether this deployment has what the tile routes need to work at all. */
function osTilesEnabled() {
  return config.get('osMaps.apiKey') !== ''
}

export { osTiles, osTilesEnabled }
