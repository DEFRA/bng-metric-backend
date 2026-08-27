import { describe, expect, test } from 'vitest'

import {
  gridFromWmtsCapabilities,
  isTileInGrid,
  tileSpanMetres
} from './grid.js'
import { TEST_GRID } from './synthetic-tiles.test-fixtures.js'

describe('#isTileInGrid', () => {
  const withMatrix = {
    ...TEST_GRID,
    matrixWidths: [5, 10],
    matrixHeights: [7, 14]
  }

  test('uses the per-level matrix dimensions when capabilities supplied them', () => {
    // grants-ui validates against 2^z, which is right for Web Mercator and
    // wrong here: the British National Grid matrix is rectangular and does not
    // double cleanly per level (z0 is 5x7, not 1x1).
    expect(isTileInGrid(withMatrix, 0, 4, 6)).toBe(true)
    expect(isTileInGrid(withMatrix, 0, 5, 0)).toBe(false)
    expect(isTileInGrid(withMatrix, 0, 0, 7)).toBe(false)
  })

  test('still bounds a tile finitely when there are no matrix dimensions', () => {
    // No capabilities to hand must never mean "anything goes" — an unbounded
    // index is what turns a proxy into an open relay.
    // At z9 one tile spans 448 m, so ~3125 tiles cover a generous national
    // extent on each axis. Inside that is plausible; far outside is not.
    expect(isTileInGrid(TEST_GRID, 9, 3000, 3000)).toBe(true)
    expect(isTileInGrid(TEST_GRID, 9, 99_999_999, 0)).toBe(false)
  })

  test('rejects anything that is not a whole, non-negative index', () => {
    expect(isTileInGrid(TEST_GRID, 9, 1.5, 0)).toBe(false)
    expect(isTileInGrid(TEST_GRID, 9, -1, 0)).toBe(false)
    expect(isTileInGrid(TEST_GRID, 9, 0, -1)).toBe(false)
    expect(isTileInGrid(TEST_GRID, Number.NaN, 0, 0)).toBe(false)
  })

  test('rejects a zoom the grid does not have', () => {
    expect(isTileInGrid(TEST_GRID, TEST_GRID.resolutions.length, 0, 0)).toBe(
      false
    )
  })
})

describe('#tileSpanMetres', () => {
  test('names the zoom it cannot serve rather than returning NaN', () => {
    expect(() => tileSpanMetres(TEST_GRID, 99)).toThrow(/outside this grid/)
  })
})

describe('#gridFromWmtsCapabilities', () => {
  test('rejects a tile matrix set the document does not contain', () => {
    expect(() =>
      gridFromWmtsCapabilities('<Capabilities/>', 'EPSG:27700')
    ).toThrow(/not found in capabilities/)
  })

  test('rejects a tile matrix set that declares no levels', () => {
    const xml = `
      <Capabilities>
        <TileMatrixSet>
          <ows:Identifier>EPSG:27700</ows:Identifier>
        </TileMatrixSet>
      </Capabilities>`

    expect(() => gridFromWmtsCapabilities(xml, 'EPSG:27700')).toThrow(
      /declared no TileMatrix entries/
    )
  })
})
