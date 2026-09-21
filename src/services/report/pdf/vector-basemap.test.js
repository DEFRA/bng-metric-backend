/**
 * The vector basemap's registration proof, as arithmetic and recorded calls.
 *
 * The raster claim was: a tile corner and a habitat vertex go through the
 * same `toPage`, so they cannot disagree. The vector claim is one step
 * longer: a tile-local vertex becomes a ground coordinate using the tile's
 * own extent, and THAT goes through the same `toPage`. These tests walk a
 * synthetic vector tile's graticule geometry back to ground coordinates,
 * check they are the round numbers the overlay would draw at, and record
 * what drawVectorBasemap actually asks pdfkit to do — decode, tile maths and
 * page transform agreeing end to end, offline.
 */

import { describe, expect, test, vi } from 'vitest'

import { decodeVectorTile } from './mvt.js'
import {
  gridFromTileMatrixSetJson,
  gridIntervalMetres,
  pickZoom,
  tileSpanMetres,
  tileTopLeft,
  tilesCovering
} from './grid.js'
import { drawVectorBasemap } from './map.js'
import { makeProjector, projectorFor } from './projector.js'
import {
  TEST_GRID,
  stubTileMatrixSetJson,
  syntheticVectorTile
} from './synthetic-tiles.test-fixtures.js'
import { VECTOR_BASEMAP_STYLE, lineWidthAtZoom } from './vector-style.js'

const FRAME = { x: 50, y: 80, width: 460, height: 320 }
const SITE = { minX: 412000, minY: 287000, maxX: 412600, maxY: 287350 }

describe('#gridFromTileMatrixSetJson', () => {
  test('a TileMatrixSet JSON document round-trips into the same grid', () => {
    const parsed = gridFromTileMatrixSetJson(stubTileMatrixSetJson(TEST_GRID))

    expect(parsed.originX).toBe(TEST_GRID.originX)
    expect(parsed.originY).toBe(TEST_GRID.originY)
    expect(parsed.tileSize).toBe(TEST_GRID.tileSize)
    expect(parsed.resolutions).toEqual([...TEST_GRID.resolutions])
    expect(Number.isFinite(parsed.matrixWidths[0])).toBe(true)
  })

  test('a mixed-origin document is rejected', () => {
    const document = stubTileMatrixSetJson(TEST_GRID)
    document.tileMatrices[1].pointOfOrigin = [0, 0]
    expect(() => gridFromTileMatrixSetJson(document)).toThrow(
      /different origins/
    )
  })

  test('an empty document is rejected', () => {
    expect(() => gridFromTileMatrixSetJson({ tileMatrices: [] })).toThrow(
      /no tileMatrices/
    )
  })
})

describe('synthetic vector tiles', () => {
  test('graticule vertices decode to round ground coordinates', () => {
    const projector = projectorFor(SITE, FRAME, { pad: 0.1 })
    const z = pickZoom(TEST_GRID, projector.extent, FRAME.width)
    const [{ col, row }] = tilesCovering(TEST_GRID, z, projector.extent)

    const span = tileSpanMetres(TEST_GRID, z)
    const [tileMinX, tileMaxY] = tileTopLeft(TEST_GRID, z, col, row)
    const interval = gridIntervalMetres(
      TEST_GRID.resolutions[z],
      TEST_GRID.tileSize
    )

    const tile = decodeVectorTile(syntheticVectorTile(TEST_GRID, z, col, row))
    const graticule = tile.layers.Graticule
    expect(graticule.features.length).toBeGreaterThan(0)

    // The tile's local extent snaps coordinates to extent-ths of the span, so
    // allow that quantisation and nothing more.
    const quantum = span / graticule.extent

    for (const feature of graticule.features) {
      for (const [localX, localY] of feature.paths.flat()) {
        const worldX = tileMinX + (localX / graticule.extent) * span
        const worldY = tileMaxY - (localY / graticule.extent) * span
        const snappedX = Math.round(worldX / interval) * interval
        const snappedY = Math.round(worldY / interval) * interval
        const onVertical = Math.abs(worldX - snappedX) <= quantum / 2
        const onHorizontal = Math.abs(worldY - snappedY) <= quantum / 2
        const onTileEdge =
          localX === 0 ||
          localY === 0 ||
          localX === graticule.extent ||
          localY === graticule.extent
        expect(onVertical || onHorizontal || onTileEdge).toBe(true)
      }
    }
  })
})

/**
 * A pdfkit stand-in recording the calls a drawing makes — the same shape
 * map.test.js uses. Every method returns the document, because pdfkit chains.
 */
function fakeDoc() {
  const calls = []
  const methods = [
    'save',
    'restore',
    'rect',
    'clip',
    'moveTo',
    'lineTo',
    'closePath',
    'fill',
    'stroke',
    'fillColor',
    'strokeColor',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'image'
  ]
  const doc = { calls }
  for (const name of methods) {
    doc[name] = vi.fn((...args) => {
      calls.push([name, ...args])
      return doc
    })
  }
  return doc
}

describe('#drawVectorBasemap', () => {
  function drawnFixture() {
    const frame = { x: 0, y: 0, width: 100, height: 100 }
    const z = 6
    const [{ col, row }] = tilesCovering(TEST_GRID, z, {
      minX: 412000,
      minY: 287000,
      maxX: 412001,
      maxY: 287001
    })
    const span = tileSpanMetres(TEST_GRID, z)
    const [tileMinX, tileMaxY] = tileTopLeft(TEST_GRID, z, col, row)
    // One whole tile fills the frame, so every graticule line is visible.
    // Shaved by a hair on the far edges: an extent ending exactly on a tile
    // boundary would (correctly) pull the neighbouring tiles into coverage.
    const shave = 0.001
    const extent = {
      minX: tileMinX,
      maxX: tileMinX + span - shave,
      minY: tileMaxY - span + shave,
      maxY: tileMaxY
    }
    const projector = makeProjector(extent, frame)
    const tile = decodeVectorTile(syntheticVectorTile(TEST_GRID, z, col, row))
    const tiles = new Map([[`${z}/${col}/${row}`, tile]])
    return { projector, tile, tiles, z, span, tileMinX, tileMaxY }
  }

  test('a graticule vertex lands exactly where the projector puts its ground coordinate', () => {
    const doc = fakeDoc()
    const { projector, tile, tiles, z, span, tileMinX, tileMaxY } =
      drawnFixture()

    const drawn = drawVectorBasemap(doc, {
      grid: TEST_GRID,
      z,
      projector,
      tiles
    })
    expect(drawn).toEqual({ tileCount: 1, z })

    // The first vertex of the first graticule line, converted the way the
    // draw path must convert it…
    const graticule = tile.layers.Graticule
    const [localX, localY] = graticule.features[0].paths[0][0]
    const [expectedX, expectedY] = projector.toPage(
      tileMinX + (localX / graticule.extent) * span,
      tileMaxY - (localY / graticule.extent) * span
    )

    // …must appear among the recorded moveTo calls (rounded to 0.01 pt).
    const moveTos = doc.calls.filter(([name]) => name === 'moveTo')
    const hit = moveTos.some(
      ([, x, y]) =>
        Math.abs(x - expectedX) <= 0.005 && Math.abs(y - expectedY) <= 0.005
    )
    expect(hit).toBe(true)
  })

  test('fills the land polygon and strokes the graticule in style order', () => {
    const doc = fakeDoc()
    const { projector, tiles, z } = drawnFixture()

    drawVectorBasemap(doc, { grid: TEST_GRID, z, projector, tiles })

    // GB_land fill first, graticule strokes after — the style's draw order.
    const firstFill = doc.calls.findIndex(([name]) => name === 'fill')
    const firstStroke = doc.calls.findIndex(([name]) => name === 'stroke')
    expect(firstFill).toBeGreaterThan(-1)
    expect(firstStroke).toBeGreaterThan(firstFill)

    // Every tile draw is clipped to the tile's own square.
    expect(doc.clip).toHaveBeenCalled()
    expect(doc.save.mock.calls.length).toBe(doc.restore.mock.calls.length)
  })

  test('a missing tile draws nothing and never places an image', () => {
    const { projector, z } = drawnFixture()
    const doc = fakeDoc()
    const drawn = drawVectorBasemap(doc, {
      grid: TEST_GRID,
      z,
      projector,
      tiles: new Map()
    })
    expect(drawn.tileCount).toBeGreaterThan(0)
    expect(doc.image).not.toHaveBeenCalled()
    expect(doc.fill).not.toHaveBeenCalled()
  })
})

describe('the vector style', () => {
  test('every pass names exactly one paint mode', () => {
    for (const pass of VECTOR_BASEMAP_STYLE) {
      const modes = [pass.fill, pass.fills, pass.line, pass.lines].filter(
        Boolean
      ).length
      expect(modes, `${pass.layer} must have exactly one paint mode`).toBe(1)
    }
  })

  test('lineWidthAtZoom clamps below, interpolates between, clamps above', () => {
    const stops = [
      [10, 2],
      [12, 6]
    ]
    expect(lineWidthAtZoom(stops, 8)).toBe(2)
    expect(lineWidthAtZoom(stops, 11)).toBe(4)
    expect(lineWidthAtZoom(stops, 15)).toBe(6)
    expect(lineWidthAtZoom([[0, 1.5]], 9)).toBe(1.5)
  })
})
