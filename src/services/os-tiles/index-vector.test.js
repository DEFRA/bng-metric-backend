/**
 * The OS tiles service's vector flavour.
 *
 * Same posture as index.test.js: only the upstream is faked. The validation,
 * caching, TileMatrixSet parsing and the ngd-base URL shape under test are
 * the ones that would ship.
 */

import { describe, expect, test } from 'vitest'

import { createOsTiles } from './index.js'
import { memoryTileCache } from './cache.js'
import { stubOsFetch } from './stub-upstream.test-fixtures.js'
import { TEST_GRID } from '../report/pdf/synthetic-tiles.test-fixtures.js'
import { decodeVectorTile } from '../report/pdf/mvt.js'

const API_KEY = 'test-key'
const silent = { warn() {}, error() {}, info() {} }

function serviceWith({ config = {}, cache, fetchImpl } = {}) {
  const upstream = stubOsFetch(TEST_GRID, { expectKey: API_KEY })
  const service = createOsTiles({
    config: { apiKey: API_KEY, ...config },
    fetchImpl: fetchImpl ?? upstream.fetch,
    logger: silent,
    cache
  })
  return { service, upstream }
}

describe('#getPublishedVectorGrid', () => {
  test('parses the TileMatrixSet document and folds in the product ceiling', async () => {
    const { service } = serviceWith()

    const grid = await service.getPublishedVectorGrid()
    expect(grid.originX).toBe(TEST_GRID.originX)
    expect(grid.originY).toBe(TEST_GRID.originY)
    expect(grid.tileSize).toBe(TEST_GRID.tileSize)
    expect(grid.resolutions).toEqual([...TEST_GRID.resolutions])
    expect(grid.maxZoom).toBe(15)
  })

  test('a failed fetch is retried rather than cached', async () => {
    let failures = 0
    const upstream = stubOsFetch(TEST_GRID, { expectKey: API_KEY })
    const { service } = serviceWith({
      fetchImpl: async (url) => {
        if (failures === 0 && url.includes('/tilematrixsets/')) {
          failures += 1
          throw new Error('transient network failure')
        }
        return upstream.fetch(url)
      }
    })

    await expect(service.getVectorGrid()).rejects.toThrow(/transient/)
    await expect(service.getVectorGrid()).resolves.toMatchObject({
      originX: TEST_GRID.originX
    })
  })
})

describe('#getVectorTile', () => {
  test('serves a decodable tile with the MVT content type, then from cache', async () => {
    const { service } = serviceWith()

    const first = await service.getVectorTile(9, 300, 400)
    expect(first.contentType).toBe('application/vnd.mapbox-vector-tile')
    expect(first.cached).toBe(false)

    const tile = decodeVectorTile(first.pbf)
    expect(tile.layers.GB_land).toBeDefined()
    expect(tile.layers.Graticule.features.length).toBeGreaterThan(0)

    const second = await service.getVectorTile(9, 300, 400)
    expect(second.cached).toBe(true)
    expect(second.pbf.equals(first.pbf)).toBe(true)
  })

  test('caches separately from the raster flavour at the same z/col/row', async () => {
    const cache = memoryTileCache({ ttlSeconds: 60 })
    const { service } = serviceWith({ cache })

    const vector = await service.getVectorTile(9, 300, 400)
    const raster = await service.getTile(9, 300, 400)

    expect(raster.cached).toBe(false)
    expect(vector.pbf.equals(raster.png)).toBe(false)
  })

  test('rejects a tile outside the grid without going upstream', async () => {
    const { service, upstream } = serviceWith()
    await service.getVectorGrid() // warm the grid
    const before = upstream.calls.length

    await expect(service.getVectorTile(9, -1, 0)).rejects.toThrow(
      /outside the ngd-base grid/
    )
    await expect(service.getVectorTile(99, 0, 0)).rejects.toThrow(/outside/)
    expect(upstream.calls.length).toBe(before)
  })

  test('asks the upstream for ROW before COLUMN, as OGC API Tiles orders them', async () => {
    const { service, upstream } = serviceWith()
    await service.getVectorTile(9, 300, 400) // col 300, row 400

    const tileCall = upstream.calls.find((call) =>
      call.includes('/tiles/27700/')
    )
    expect(tileCall).toContain('/tiles/27700/9/400/300?')
  })

  test('a 401 names the NGD product, not the raster one', async () => {
    const { service } = serviceWith({ config: { apiKey: 'wrong-key' } })

    // The FIRST thing the flavour fetches is the tiling-scheme document, so
    // that is where a bad key surfaces — and the diagnostic must name the
    // product that request needed.
    await expect(service.getVectorTile(9, 300, 400)).rejects.toThrow(
      /"OS NGD API – Tiles" product/
    )
  })
})
