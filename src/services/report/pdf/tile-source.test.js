import { describe, expect, test, vi } from 'vitest'

import { osTileSource, osVectorTileSource } from './tile-source.js'
import { isOsTileError } from '../../os-tiles/errors.js'
import { TEST_GRID } from './synthetic-tiles.test-fixtures.js'

/**
 * Bytes that open like a PNG. The tile source checks the signature — a
 * response can be a 200 and still not be an image — so a stand-in has to
 * carry one.
 */
function pngBytes(payload) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(payload)
  ])
}

describe('#osTileSource', () => {
  test('returns the PNG the service gives it', async () => {
    const png = pngBytes('tile')
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
      getTile: vi.fn().mockResolvedValue({ png: pngBytes('tile') })
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

describe('#osTileSource on a body that is not an image', () => {
  test('reports it as a tile failure, not a drawing fault', async () => {
    // A 200 carrying an HTML error page. drawBasemap hands these bytes to
    // doc.image, which throws a bare Error('Unknown image format.') — at the
    // builder that is indistinguishable from a bug in the renderer, so the
    // report 500s instead of falling back to a plain ground. Raised in review
    // on #297.
    const osTiles = {
      getTile: vi.fn().mockResolvedValue({
        png: Buffer.from('<html><body>Service Unavailable</body></html>')
      })
    }

    const failure = await osTileSource(osTiles)(TEST_GRID, 9, 300, 400)
      .then(() => null)
      .catch((error) => error)

    expect(failure).not.toBeNull()
    expect(isOsTileError(failure)).toBe(true)
    expect(failure.message).toContain('9/300/400')
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
