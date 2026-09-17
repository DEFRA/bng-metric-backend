import { describe, expect, test, vi } from 'vitest'

import { osTileSource, osVectorTileSource } from './tile-source.js'
import { isOsTileError } from '../../os-tiles/errors.js'
import { TEST_GRID } from './synthetic-tiles.test-fixtures.js'

describe('#osTileSource', () => {
  test('returns the PNG the service gives it', async () => {
    const png = Buffer.from('tile')
    const osTiles = { getTile: vi.fn().mockResolvedValue({ png }) }

    const tile = await osTileSource(osTiles)(TEST_GRID, 9, 300, 400)

    expect(tile).toEqual({ png })
    expect(osTiles.getTile).toHaveBeenCalledWith(9, 300, 400)
  })

  test('asks for the same tile only once per document', async () => {
    // A single report asks for the same ground many times over — neighbouring
    // parcels overlap — and there is no reason to round-trip an async cache for
    // an answer already in hand.
    const osTiles = {
      getTile: vi.fn().mockResolvedValue({ png: Buffer.from('tile') })
    }
    const source = osTileSource(osTiles)

    await Promise.all([
      source(TEST_GRID, 9, 300, 400),
      source(TEST_GRID, 9, 300, 400),
      source(TEST_GRID, 9, 300, 401)
    ])

    expect(osTiles.getTile).toHaveBeenCalledTimes(2)
  })

  test('lets a tile failure reach the caller rather than drawing a hole', async () => {
    const osTiles = {
      getTile: vi.fn().mockRejectedValue(new Error('403 from OS'))
    }

    await expect(osTileSource(osTiles)(TEST_GRID, 9, 300, 400)).rejects.toThrow(
      /403 from OS/
    )
  })
})

describe('#osVectorTileSource', () => {
  test('reports an unreadable tile as a tile failure, not a drawing fault', async () => {
    const osTiles = {
      getVectorTile: vi
        .fn()
        .mockResolvedValue({ pbf: Buffer.from('not a tile') })
    }

    const failure = await osVectorTileSource(osTiles)(TEST_GRID, 9, 300, 400)
      .then(() => null)
      .catch((error) => error)

    // A malformed payload from OS is a basemap problem, and the report
    // degrades around those. Left as the protobuf reader's own TypeError it
    // would arrive at the builder looking exactly like a renderer bug — which
    // the builder must NOT hide behind a substituted basemap.
    expect(failure).not.toBeNull()
    expect(isOsTileError(failure)).toBe(true)
    expect(failure.message).toContain('9/300/400')
  })
})
