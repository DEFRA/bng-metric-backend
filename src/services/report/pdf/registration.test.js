/**
 * The registration proof.
 *
 * The claim under test: basemap tiles and habitat geometry cannot land in
 * different places, because both are positioned by the same `toPage` call. A
 * map tile is not an arbitrary picture — it covers an exact, known rectangle of
 * ground — so a tile corner and a habitat vertex are the same kind of thing: an
 * EPSG:27700 coordinate.
 *
 * These are pure arithmetic — no network, no API key, no PDF to inspect. If
 * they pass, alignment is correct by construction rather than by eye.
 */

import { describe, expect, test } from 'vitest'

import { makeProjector, projectorFor } from './projector.js'
import {
  effectiveDpi,
  gridFromWmtsCapabilities,
  gridIntervalMetres,
  pickZoom,
  tileSpanMetres,
  tileTopLeft,
  tilesCovering
} from './grid.js'
import {
  TEST_GRID,
  syntheticTileSource
} from './synthetic-tiles.test-fixtures.js'

const FRAME = { x: 50, y: 80, width: 460, height: 320 }
const SITE = { minX: 412000, minY: 287000, maxX: 412600, maxY: 287350 }
const TOLERANCE = 1e-9

function projector() {
  return projectorFor(SITE, FRAME, { pad: 0.1 })
}

describe('tiles and geometry share one transform', () => {
  test('adjacent tiles abut exactly, with no gap and no overlap', () => {
    const proj = projector()
    const z = pickZoom(TEST_GRID, proj.extent, FRAME.width)
    const sizeInPoints = proj.metresToPoints(tileSpanMetres(TEST_GRID, z))

    const [ax, ay] = proj.toPage(...tileTopLeft(TEST_GRID, z, 10, 10))
    const [bx] = proj.toPage(...tileTopLeft(TEST_GRID, z, 11, 10))
    const [, by] = proj.toPage(...tileTopLeft(TEST_GRID, z, 10, 11))

    expect(Math.abs(bx - ax - sizeInPoints)).toBeLessThan(TOLERANCE)
    expect(Math.abs(by - ay - sizeInPoints)).toBeLessThan(TOLERANCE)
  })

  test('the covering tile set actually covers the visible extent', () => {
    const proj = projector()
    const z = pickZoom(TEST_GRID, proj.extent, FRAME.width)
    const span = tileSpanMetres(TEST_GRID, z)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const { col, row } of tilesCovering(TEST_GRID, z, proj.extent)) {
      const [x, y] = tileTopLeft(TEST_GRID, z, col, row)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x + span)
      maxY = Math.max(maxY, y)
      minY = Math.min(minY, y - span)
    }

    expect(minX).toBeLessThanOrEqual(proj.extent.minX)
    expect(maxX).toBeGreaterThanOrEqual(proj.extent.maxX)
    expect(minY).toBeLessThanOrEqual(proj.extent.minY)
    expect(maxY).toBeGreaterThanOrEqual(proj.extent.maxY)
  })

  test('tile rows run southward as northing decreases', () => {
    const proj = projector()
    const [, topOfRow10] = proj.toPage(...tileTopLeft(TEST_GRID, 8, 0, 10))
    const [, topOfRow11] = proj.toPage(...tileTopLeft(TEST_GRID, 8, 0, 11))

    expect(topOfRow11).toBeGreaterThan(topOfRow10)
  })

  test('a round coordinate lands where the tile paints it', () => {
    // The synthetic basemap draws its grid at round world coordinates in tile
    // pixel space; the overlay draws the same coordinates through toPage. This
    // asserts the two agree — the arithmetic behind the visual proof.
    const proj = projector()
    const z = pickZoom(TEST_GRID, proj.extent, FRAME.width)
    const resolution = TEST_GRID.resolutions[z]
    const span = tileSpanMetres(TEST_GRID, z)

    const { col, row } = tilesCovering(TEST_GRID, z, proj.extent)[0]
    const [tileMinX, tileMaxY] = tileTopLeft(TEST_GRID, z, col, row)

    const roundEasting = Math.ceil(tileMinX / 100) * 100
    expect(roundEasting).toBeLessThan(tileMinX + span)

    // Where the tile paints it: pixels from the tile's own left edge.
    const pixelInTile = (roundEasting - tileMinX) / resolution
    const [tilePageX] = proj.toPage(tileMinX, tileMaxY)
    const paintedAt = tilePageX + pixelInTile * resolution * proj.scale

    // Where the vector overlay draws it.
    const [drawnAt] = proj.toPage(roundEasting, tileMaxY)

    expect(Math.abs(paintedAt - drawnAt)).toBeLessThan(TOLERANCE)
  })

  test('sharpness and registration are independent', () => {
    // Deliberately choose a far too coarse zoom. Alignment must be unaffected —
    // a blurry basemap is a zoom problem, never a transform problem.
    const proj = projector()
    const sizeInPoints = proj.metresToPoints(tileSpanMetres(TEST_GRID, 2))

    const [ax] = proj.toPage(...tileTopLeft(TEST_GRID, 2, 3, 3))
    const [bx] = proj.toPage(...tileTopLeft(TEST_GRID, 2, 4, 3))

    expect(Math.abs(bx - ax - sizeInPoints)).toBeLessThan(TOLERANCE)
  })

  test('a non-square frame still keeps tiles square', () => {
    const skinny = { x: 0, y: 0, width: 500, height: 120 }
    const proj = makeProjector(
      { minX: 0, minY: 0, maxX: 5000, maxY: 1200 },
      skinny
    )
    const size = proj.metresToPoints(tileSpanMetres(TEST_GRID, 6))

    const [ax, ay] = proj.toPage(...tileTopLeft(TEST_GRID, 6, 2, 2))
    const [bx] = proj.toPage(...tileTopLeft(TEST_GRID, 6, 3, 2))
    const [, by] = proj.toPage(...tileTopLeft(TEST_GRID, 6, 2, 3))

    expect(Math.abs(bx - ax - size)).toBeLessThan(TOLERANCE)
    expect(Math.abs(by - ay - size)).toBeLessThan(TOLERANCE)
  })
})

describe('#pickZoom', () => {
  test('meets the requested print density', () => {
    const proj = projector()

    for (const dpi of [150, 200, 300]) {
      const z = pickZoom(TEST_GRID, proj.extent, FRAME.width, dpi)
      expect(
        effectiveDpi(TEST_GRID, z, proj.extent, FRAME.width)
      ).toBeGreaterThanOrEqual(dpi)
    }
  })

  test('never exceeds the grid maxZoom the deployment can actually fetch', () => {
    // maxZoom folds in both the product's ceiling and the plan's, so a builder
    // clamped by it can never ask for a tile that would 403 — and a too-coarse
    // zoom costs sharpness only, never registration.
    const proj = projector()
    const clamped = { ...TEST_GRID, maxZoom: 6 }

    expect(
      pickZoom(clamped, proj.extent, FRAME.width, 300)
    ).toBeLessThanOrEqual(6)
  })
})

describe('#gridFromWmtsCapabilities', () => {
  test('parses the grid rather than trusting a hard-coded constant', () => {
    const xml = `
      <Capabilities>
        <TileMatrixSet>
          <ows:Identifier>EPSG:27700</ows:Identifier>
          <TileMatrix>
            <ows:Identifier>0</ows:Identifier>
            <ScaleDenominator>3200000</ScaleDenominator>
            <TopLeftCorner>-238375.0 1376256.0</TopLeftCorner>
            <TileWidth>256</TileWidth>
          </TileMatrix>
          <TileMatrix>
            <ows:Identifier>1</ows:Identifier>
            <ScaleDenominator>1600000</ScaleDenominator>
            <TopLeftCorner>-238375.0 1376256.0</TopLeftCorner>
            <TileWidth>256</TileWidth>
          </TileMatrix>
        </TileMatrixSet>
      </Capabilities>`

    const grid = gridFromWmtsCapabilities(xml, 'EPSG:27700')

    expect(grid.originX).toBe(-238375)
    expect(grid.originY).toBe(1376256)
    expect(grid.tileSize).toBe(256)
    // 3200000 * 0.00028 = 896 m/px
    expect(Math.abs(grid.resolutions[0] - 896)).toBeLessThan(TOLERANCE)
    expect(Math.abs(grid.resolutions[1] - 448)).toBeLessThan(TOLERANCE)
  })

  test('refuses levels that declare different origins', () => {
    const xml = `
      <Capabilities>
        <TileMatrixSet>
          <ows:Identifier>EPSG:27700</ows:Identifier>
          <TileMatrix>
            <ScaleDenominator>3200000</ScaleDenominator>
            <TopLeftCorner>-238375.0 1376256.0</TopLeftCorner>
            <TileWidth>256</TileWidth>
          </TileMatrix>
          <TileMatrix>
            <ScaleDenominator>1600000</ScaleDenominator>
            <TopLeftCorner>0.0 1376256.0</TopLeftCorner>
            <TileWidth>256</TileWidth>
          </TileMatrix>
        </TileMatrixSet>
      </Capabilities>`

    expect(() => gridFromWmtsCapabilities(xml, 'EPSG:27700')).toThrow(
      /different origins/
    )
  })
})

describe('#gridIntervalMetres', () => {
  test('is derived from the grid, never read off a tile', () => {
    // Regression: the interval used to be read from the tile object, which only
    // the synthetic source supplies. Against any real OS basemap that property
    // is absent, so the graticule silently stopped drawing and the visual proof
    // disabled itself without failing.
    const z = 10
    const derived = gridIntervalMetres(
      TEST_GRID.resolutions[z],
      TEST_GRID.tileSize
    )
    const painted = syntheticTileSource()(TEST_GRID, z, 300, 400).interval

    expect(derived).toBeGreaterThan(0)
    expect(painted).toBe(derived)
  })

  test('is computable at every zoom with no tile in hand', () => {
    for (const resolution of TEST_GRID.resolutions) {
      expect(
        gridIntervalMetres(resolution, TEST_GRID.tileSize)
      ).toBeGreaterThan(0)
    }
  })
})
