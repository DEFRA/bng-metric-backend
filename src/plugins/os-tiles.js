/**
 * The OS tiles routes, and the service both they and the report builder use.
 *
 *   GET /os-tiles/capabilities         the EPSG:27700 grid, as JSON
 *   GET /os-tiles/{z}/{col}/{row}.png  one raster tile
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
    cacheMaxEntries: config.get('osMaps.cacheMaxEntries')
  }
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
     * use the first; a future Redis cache would arrive through the second
     * without this file changing.
     */
    register(server, options = {}) {
      const service = createOsTiles({
        config: osTilesConfig(),
        logger,
        fetchImpl: options.fetchImpl,
        cache: options.cache
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
