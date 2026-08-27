import { describe, expect, test, vi } from 'vitest'

import { osTileSource } from './tile-source.js'
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
