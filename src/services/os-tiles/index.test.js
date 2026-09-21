/**
 * The OS tiles service.
 *
 * Only the upstream is faked. The validation, caching, plan clamping and
 * capabilities parsing under test are the ones that would ship.
 */

import { describe, expect, test, vi } from 'vitest'

import { createOsTiles } from './index.js'
import { isOsTileError } from './errors.js'
import { resolveOsTilesConfig } from './config.js'
import { stubOsFetch } from './stub-upstream.test-fixtures.js'
import { stubTileCache } from './tile-cache.test-fixtures.js'
import { TEST_GRID } from '../report/pdf/synthetic-tiles.test-fixtures.js'
import { pickZoom } from '../report/pdf/grid.js'

const API_KEY = 'test-key'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
const silent = { warn() {}, error() {}, info() {} }

function serviceWith({ config = {}, cache, fetchImpl, logger } = {}) {
  const upstream = stubOsFetch(TEST_GRID, { expectKey: API_KEY })
  const service = createOsTiles({
    config: { apiKey: API_KEY, ...config },
    fetchImpl: fetchImpl ?? upstream.fetch,
    logger: logger ?? silent,
    cache
  })
  return { service, upstream }
}

// Calls are recorded as path + query, so the extension has to be matched
// before the `?key=` — otherwise this counts nothing and every assertion
// built on it passes vacuously.
function tileCalls(upstream) {
  return upstream.calls.filter((call) => call.split('?')[0].endsWith('.png'))
    .length
}

describe('#getPublishedGrid', () => {
  test('serves the EPSG:27700 grid parsed from capabilities', async () => {
    const { service } = serviceWith()

    const grid = await service.getPublishedGrid()

    expect(grid.originX).toBe(TEST_GRID.originX)
    expect(grid.originY).toBe(TEST_GRID.originY)
    expect(grid.tileSize).toBe(256)
    expect(Math.abs(grid.resolutions[0] - 896)).toBeLessThan(1e-9)
    // Matrix dimensions must survive — tile validation depends on them, and
    // they are not 2^z on a national grid.
    expect(Number.isFinite(grid.matrixWidths[0])).toBe(true)
  })

  test('publishes maxZoom so a client need not know the OS plan', async () => {
    const { service } = serviceWith({ config: { maxZoom: 9 } })

    expect((await service.getPublishedGrid()).maxZoom).toBe(9)
  })

  test('fetches capabilities once and reuses it', async () => {
    const { service, upstream } = serviceWith()

    await service.getPublishedGrid()
    await service.getPublishedGrid()

    const capabilitiesCalls = upstream.calls.filter((call) =>
      call.includes('GetCapabilities')
    )
    expect(capabilitiesCalls.length).toBe(1)
  })

  test('lets a transient capabilities failure be retried', async () => {
    let attempt = 0
    const upstream = stubOsFetch(TEST_GRID)
    const service = createOsTiles({
      config: { apiKey: API_KEY },
      logger: silent,
      fetchImpl: async (url) => {
        attempt += 1
        if (attempt === 1) {
          throw new Error('connection reset')
        }
        return upstream.fetch(url)
      }
    })

    await expect(service.getGrid()).rejects.toThrow(/connection reset/)
    await expect(service.getGrid()).resolves.toBeDefined()
  })
})

describe('#getTile', () => {
  test('serves a PNG', async () => {
    const { service } = serviceWith()

    const tile = await service.getTile(9, 300, 400)

    expect(tile.contentType).toBe('image/png')
    expect([...tile.png.subarray(0, 4)]).toEqual(PNG_SIGNATURE)
  })

  test('sends the key upstream, and returns it to nobody', async () => {
    const { service, upstream } = serviceWith()

    const tile = await service.getTile(9, 300, 400)

    expect(upstream.calls.length).toBeGreaterThan(0)
    expect(
      upstream.calls.every((call) => call.includes(`key=${API_KEY}`))
    ).toBe(true)
    expect(tile.png.includes(Buffer.from(API_KEY))).toBe(false)
  })

  test('serves a repeat request from cache', async () => {
    const cache = stubTileCache()
    const { service, upstream } = serviceWith({ cache })

    const first = await service.getTile(9, 300, 400)
    const callsAfterFirst = tileCalls(upstream)
    const second = await service.getTile(9, 300, 400)

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(tileCalls(upstream)).toBe(callsAfterFirst)
    expect(second.png).toEqual(first.png)
    expect(cache.size()).toBe(1)
  })

  test('without a cache, every request goes upstream', async () => {
    // The service's default. Production always injects a cache; a caller that
    // does not should get uncached behaviour rather than a surprise.
    const { service, upstream } = serviceWith()

    const first = await service.getTile(9, 300, 400)
    const callsAfterFirst = tileCalls(upstream)
    const second = await service.getTile(9, 300, 400)

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(false)
    expect(tileCalls(upstream)).toBe(callsAfterFirst + 1)
  })

  test('rejects out-of-range coordinates without going upstream', async () => {
    const { service, upstream } = serviceWith()
    await service.getPublishedGrid() // warm the grid
    const before = upstream.calls.length

    const outOfRange = [
      [9, -1, 0],
      [9, 0, -5],
      [99, 0, 0],
      [9, 99_999_999, 0]
    ]
    for (const [z, col, row] of outOfRange) {
      await expect(service.getTile(z, col, row)).rejects.toMatchObject({
        status: 404
      })
    }

    // The point of validating locally: an unbounded index from a client must
    // never become an outbound request onto someone else's paid API.
    expect(upstream.calls.length).toBe(before)
  })

  test('refuses a zoom above the layer maximum', async () => {
    // Leisure_27700 stops at zoom 9 where the others go to 13.
    const { service } = serviceWith({ config: { layer: 'Leisure_27700' } })

    await expect(service.getTile(9, 300, 400)).resolves.toBeDefined()
    await expect(service.getTile(12, 300, 400)).rejects.toThrow(
      /exceeds the maximum zoom 9/
    )
  })

  test('refuses a zoom above the plan ceiling locally, without calling OS', async () => {
    const logger = { warn() {}, error() {}, info: vi.fn() }
    const { service, upstream } = serviceWith({
      config: { maxZoom: 9 },
      logger
    })
    await service.getPublishedGrid()
    const before = tileCalls(upstream)

    // The caller is told the ceiling it crossed and nothing else...
    await expect(service.getTile(10, 3016, 5628)).rejects.toThrow(
      /exceeds the maximum zoom 9/
    )
    // ...while the operator's half — which variable to change, and that a
    // Premium/PSGA key lifts it — goes to the log. A browser fetching tiles
    // has no business knowing either.
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/OS_MAPS_MAX_ZOOM.*Premium\/PSGA/s)
    )
    // Without the local check this is a burst of opaque 403s and no document.
    expect(tileCalls(upstream)).toBe(before)
  })

  test('explains the two ways a key can be wrong when OS returns 401', async () => {
    const { service } = serviceWith({ config: { apiKey: 'wrong-key' } })

    await expect(service.getTile(9, 300, 400)).rejects.toThrow(
      /OS Maps API" product added/
    )
  })

  test('gives up on a request that hangs, rather than holding the report open', async () => {
    const upstream = stubOsFetch(TEST_GRID)
    const { service } = serviceWith({
      config: { requestTimeoutMs: 10 },
      fetchImpl: (url, options) =>
        url.includes('wmts')
          ? upstream.fetch(url)
          : new Promise((_resolve, reject) => {
              // What a hung connection looks like: the promise never settles
              // on its own, and only the abort signal ends it.
              options.signal.addEventListener('abort', () =>
                reject(options.signal.reason)
              )
            })
    })

    const failure = await service.getTile(9, 1508, 2814).catch((error) => error)

    // A report fetches upwards of a hundred tiles, so one connection that
    // hangs rather than fails would cost the whole download.
    expect(isOsTileError(failure)).toBe(true)
    expect(failure.message).toMatch(/Could not reach Ordnance Survey/)
  })

  test('reports a connection failure as a tile failure, not a bug', async () => {
    const upstream = stubOsFetch(TEST_GRID)
    const { service } = serviceWith({
      fetchImpl: (url) =>
        url.includes('wmts')
          ? upstream.fetch(url)
          : Promise.reject(new TypeError('fetch failed'))
    })

    const failure = await service.getTile(9, 1508, 2814).catch((error) => error)

    // `fetch` reports a reset or a DNS failure as a TypeError, which at the
    // far end is indistinguishable from a bug in the calling code — so a
    // report would 500 over an unreachable basemap instead of degrading.
    expect(isOsTileError(failure)).toBe(true)
    expect(failure.upstream).toBe(true)
    expect(failure.cause).toBeInstanceOf(TypeError)
  })

  test('reports a tile that arrives unreadable as a tile failure', async () => {
    const upstream = stubOsFetch(TEST_GRID)
    const { service } = serviceWith({
      fetchImpl: async (url) =>
        url.includes('wmts')
          ? upstream.fetch(url)
          : {
              ok: true,
              status: 200,
              headers: { get: () => 'image/png' },
              // What a connection dropped mid-body looks like.
              arrayBuffer: async () => {
                throw new TypeError('terminated')
              }
            }
    })

    const failure = await service.getTile(9, 1508, 2814).catch((error) => error)

    // The deadline covers the body as well as the headers, so it can fire
    // after a response has started arriving — and a report should degrade to a
    // plain ground over that, not 500.
    expect(isOsTileError(failure)).toBe(true)
    expect(failure.upstream).toBe(true)
  })

  test('refuses a 200 that is not an image, and does not cache it', async () => {
    const upstream = stubOsFetch(TEST_GRID)
    const cache = stubTileCache()
    const { service } = serviceWith({
      cache,
      fetchImpl: async (url) =>
        url.includes('wmts')
          ? upstream.fetch(url)
          : {
              // What a gateway in front of api.os.uk answers with on a bad
              // day: an HTML error page, 200, labelled as a tile.
              ok: true,
              status: 200,
              headers: { get: () => 'image/png' },
              arrayBuffer: async () =>
                new TextEncoder().encode('<html>Service Unavailable</html>')
                  .buffer
            }
    })

    const failure = await service.getTile(9, 1508, 2814).catch((error) => error)

    expect(isOsTileError(failure)).toBe(true)
    expect(failure.message).toMatch(/not a PNG or JPEG/)
    // The cache holds tiles for a week by default, so storing one junk body
    // would poison every later report and browser tile until it expired.
    expect(cache.size()).toBe(0)
  })

  test('reports a 403 as a plan problem, not a key problem', async () => {
    // These are different failures and were both observed live. Conflating them
    // sends people looking for a new key when the fix is OS_MAPS_MAX_ZOOM.
    const upstream = stubOsFetch(TEST_GRID)
    const { service } = serviceWith({
      fetchImpl: async (url) =>
        url.includes('wmts')
          ? upstream.fetch(url)
          : {
              ok: false,
              status: 403,
              headers: { get: () => 'text/xml' },
              text: async () => 'A Premium Plan is required',
              arrayBuffer: async () => new ArrayBuffer(0)
            }
    })

    const failure = await service.getTile(9, 1508, 2814).catch((error) => error)

    expect(failure.status).toBe(403)
    expect(failure.message).toMatch(/Premium Plan/)
    expect(failure.message).toMatch(/OS_MAPS_MAX_ZOOM=9/)
    expect(failure.message).not.toMatch(/OS_API_KEY is unset/)
  })
})

describe('startup diagnostics', () => {
  test('warns once when the key is missing', () => {
    const warnings = []
    createOsTiles({
      config: { apiKey: '' },
      logger: { ...silent, warn: (message) => warnings.push(message) }
    })

    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/OS_API_KEY is not set/)
  })

  test('rejects an unknown layer at construction, not at request time', () => {
    expect(() =>
      createOsTiles({ config: { layer: 'Light_3857' }, logger: silent })
    ).toThrow(/Unknown OS layer/)
  })
})

describe('the plan ceiling', () => {
  test('caps the effective zoom without ever exceeding the product maximum', () => {
    expect(resolveOsTilesConfig({ apiKey: 'k' }).maxZoom).toBe(13)
    expect(resolveOsTilesConfig({ apiKey: 'k', maxZoom: 9 }).maxZoom).toBe(9)
    // A plan cannot grant more than the product publishes.
    expect(resolveOsTilesConfig({ apiKey: 'k', maxZoom: 99 }).maxZoom).toBe(13)
    // Leisure_27700 stops at 9 regardless of plan.
    expect(
      resolveOsTilesConfig({ apiKey: 'k', layer: 'Leisure_27700', maxZoom: 13 })
        .maxZoom
    ).toBe(9)
  })

  test('is what pickZoom clamps to, rather than requesting a doomed tile', () => {
    const capped = { ...TEST_GRID, maxZoom: 9 }
    // A frame that would otherwise demand a much finer zoom.
    const extent = { minX: 437000, minY: 115000, maxX: 437200, maxY: 115200 }

    expect(pickZoom(TEST_GRID, extent, 400)).toBeGreaterThan(9)
    expect(pickZoom(capped, extent, 400)).toBe(9)
  })
})
