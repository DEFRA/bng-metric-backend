/**
 * The tile routes, mounted in a real Hapi server. Only the upstream is faked.
 */

import Hapi from '@hapi/hapi'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { osTiles, osTilesEnabled } from './os-tiles.js'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { stubOsFetch } from '../services/os-tiles/stub-upstream.test-fixtures.js'
import { TEST_GRID } from '../services/report/pdf/synthetic-tiles.test-fixtures.js'

const API_KEY = 'test-key'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

const CONFIG_VALUES = {
  'osMaps.apiKey': API_KEY,
  'osMaps.layer': 'Light_27700',
  'osMaps.maxZoom': '',
  'osMaps.cacheTtlSeconds': 3600,
  'osMaps.cacheMaxBytes': 1048576
}

function stubConfig(overrides = {}) {
  const values = { ...CONFIG_VALUES, ...overrides }
  vi.spyOn(config, 'get').mockImplementation((key) =>
    key in values ? values[key] : config.default(key)
  )
}

async function serverWith(overrides = {}) {
  stubConfig(overrides)
  const upstream = stubOsFetch(TEST_GRID, { expectKey: API_KEY })

  const server = Hapi.server({ port: 0 })
  // Everything under test is the code that would ship; only the upstream —
  // the one seam that talks to the internet — is faked.
  await server.register({
    plugin: osTiles.plugin,
    options: { fetchImpl: upstream.fetch }
  })
  await server.initialize()

  return { server, upstream }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('#osTilesEnabled', () => {
  test('is false without a key, so the routes are never published', () => {
    stubConfig({ 'osMaps.apiKey': '' })

    expect(osTilesEnabled()).toBe(false)
  })

  test('is true once a key is configured', () => {
    stubConfig()

    expect(osTilesEnabled()).toBe(true)
  })
})

describe('the tile routes', () => {
  test('inherit the service-wide auth default rather than opting out', async () => {
    // An unauthenticated tile route is an open relay onto a paid API. Secure by
    // default means these must not set `auth: false` — see
    // docs/auth-route-policy.md, where `undefined` is the protected case.
    const { server } = await serverWith()

    const routes = server
      .table()
      .filter((route) => route.path.startsWith('/os-tiles'))

    expect(routes.length).toBe(4)
    for (const route of routes) {
      expect(route.settings.auth).toBeUndefined()
    }
  })
})

describe('GET /os-tiles/capabilities', () => {
  test('serves the grid as JSON', async () => {
    const { server } = await serverWith()

    const response = await server.inject('/os-tiles/capabilities')

    expect(response.statusCode).toBe(200)
    const { layer, grid } = JSON.parse(response.payload)
    expect(layer).toBe('Light_27700')
    expect(grid.originX).toBe(TEST_GRID.originX)
    expect(grid.maxZoom).toBe(13)
  })

  test('reports an unreachable upstream as a bad gateway', async () => {
    stubConfig()
    const errors = vi.spyOn(createLogger(), 'error')
    const server = Hapi.server({ port: 0 })
    await server.register(osTiles)
    server.app.osTiles.getGrid = vi
      .fn()
      .mockRejectedValue(new Error('upstream down'))
    await server.initialize()

    const response = await server.inject('/os-tiles/capabilities')

    expect(response.statusCode).toBe(502)
    expect(errors).toHaveBeenCalled()
  })
})

describe('GET /os-tiles/{z}/{col}/{row}.png', () => {
  test('serves a PNG and says whether it came from cache', async () => {
    const { server } = await serverWith()

    const first = await server.inject('/os-tiles/9/300/400.png')
    const second = await server.inject('/os-tiles/9/300/400.png')

    expect(first.statusCode).toBe(200)
    expect(first.headers['content-type']).toBe('image/png')
    expect([...first.rawPayload.subarray(0, 4)]).toEqual(PNG_SIGNATURE)
    expect(first.headers['x-tile-cache']).toBe('miss')
    expect(second.headers['x-tile-cache']).toBe('hit')
  })

  test('never lets the API key reach a response', async () => {
    const { server } = await serverWith()

    for (const path of ['/os-tiles/capabilities', '/os-tiles/9/300/400.png']) {
      const response = await server.inject(path)
      expect(response.rawPayload.includes(Buffer.from(API_KEY))).toBe(false)
    }
  })

  test('rejects a tile outside the grid with a 404', async () => {
    const { server, upstream } = await serverWith()
    await server.inject('/os-tiles/capabilities')
    const before = upstream.calls.length

    const response = await server.inject('/os-tiles/9/99999999/0.png')

    expect(response.statusCode).toBe(404)
    expect(upstream.calls.length).toBe(before)
  })

  test('says what this service itself refused, and why', async () => {
    const { server } = await serverWith()

    const response = await server.inject('/os-tiles/9/99999999/0.png')

    // This message was written here, about the request that was just made, so
    // it is both safe to repeat and the most useful thing to say.
    expect(JSON.parse(response.payload).error).toContain('outside')
  })

  test('rejects a coordinate that is not a tile coordinate', async () => {
    const { server, upstream } = await serverWith()

    const response = await server.inject('/os-tiles/9/not-a-column/0.png')

    // Nothing downstream should have to reason about Number('not-a-column')
    // being NaN, and no unvalidated fragment of a URL should reach a log line
    // or a response body.
    expect(response.statusCode).toBe(400)
    expect(upstream.calls.length).toBe(0)
  })
})

describe('what a failure is allowed to say', () => {
  /** A server whose upstream answers every request with `status`. */
  async function serverRefusing(status, body) {
    stubConfig()
    const server = Hapi.server({ port: 0 })
    await server.register({
      plugin: osTiles.plugin,
      options: {
        fetchImpl: async () => ({
          ok: false,
          status,
          statusText: body,
          text: async () => body,
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0),
          headers: new Map()
        })
      }
    })
    await server.initialize()
    return server
  }

  test('does not repeat what Ordnance Survey said to the caller', async () => {
    const errors = vi.spyOn(createLogger(), 'error')
    const server = await serverRefusing(401, 'Key rejected: project acme-42')

    const response = await server.inject('/os-tiles/capabilities')

    // The upstream text comes from a third party whose payloads we do not
    // control, and our own wording for it names the environment variables to
    // change. Neither belongs in a response; both belong in the log.
    const { error } = JSON.parse(response.payload)
    expect(error).toBe('Ordnance Survey basemap tiles are unavailable')
    expect(error).not.toContain('acme-42')
    expect(error).not.toContain('OS_API_KEY')
    expect(errors).toHaveBeenCalled()
  })

  test("does not hand a caller Ordnance Survey's authentication status", async () => {
    const server = await serverRefusing(401, 'Unauthorized')

    const response = await server.inject('/os-tiles/capabilities')

    // A 401 here is this deployment's credential problem, not the caller's.
    // Forwarded as-is it would tell a browser whose own token is perfectly
    // valid to go and authenticate again.
    expect(response.statusCode).toBe(502)
  })

  test('still reports a tile Ordnance Survey does not have as missing', async () => {
    const server = await serverRefusing(404, 'Not Found')

    const response = await server.inject('/os-tiles/capabilities')

    // "No such tile" is a true answer to the question that was asked, and the
    // one upstream status a caller can act on.
    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.payload).error).toBe(
      'That tile is not available'
    )
  })
})

describe('GET /os-tiles/vector/capabilities', () => {
  test('serves the vector tiling scheme with the product ceiling folded in', async () => {
    const { server } = await serverWith()

    const response = await server.inject('/os-tiles/vector/capabilities')

    expect(response.statusCode).toBe(200)
    const { layer, grid } = JSON.parse(response.payload)
    expect(layer).toBe('ngd-base')
    expect(grid.originX).toBe(TEST_GRID.originX)
    expect(grid.maxZoom).toBe(15)
  })
})

describe('GET /os-tiles/vector/{z}/{col}/{row}.pbf', () => {
  test('serves a vector tile with the MVT content type, then from cache', async () => {
    const { server } = await serverWith()

    const first = await server.inject('/os-tiles/vector/9/300/400.pbf')
    const second = await server.inject('/os-tiles/vector/9/300/400.pbf')

    expect(first.statusCode).toBe(200)
    expect(first.headers['content-type']).toContain(
      'application/vnd.mapbox-vector-tile'
    )
    expect(first.headers['x-tile-cache']).toBe('miss')
    expect(second.headers['x-tile-cache']).toBe('hit')
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true)
  })

  test('does not collide with the raster cache at the same coordinates', async () => {
    const { server } = await serverWith()

    const vector = await server.inject('/os-tiles/vector/9/300/400.pbf')
    const raster = await server.inject('/os-tiles/9/300/400.png')

    expect(raster.headers['x-tile-cache']).toBe('miss')
    expect(vector.rawPayload.equals(raster.rawPayload)).toBe(false)
  })

  test('never lets the API key reach a response', async () => {
    const { server } = await serverWith()

    for (const path of [
      '/os-tiles/vector/capabilities',
      '/os-tiles/vector/9/300/400.pbf'
    ]) {
      const response = await server.inject(path)
      expect(response.rawPayload.includes(Buffer.from(API_KEY))).toBe(false)
    }
  })

  test('rejects a tile outside the grid with a 404, without going upstream', async () => {
    const { server, upstream } = await serverWith()
    await server.inject('/os-tiles/vector/capabilities')
    const before = upstream.calls.length

    const response = await server.inject('/os-tiles/vector/99/0/0.pbf')

    expect(response.statusCode).toBe(404)
    expect(upstream.calls.length).toBe(before)
  })
})
