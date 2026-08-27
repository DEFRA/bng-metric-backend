/**
 * A synthetic basemap, and the minimal PNG encoder behind it.
 *
 * Test-only, and deliberately so: production tiles come from Ordnance Survey
 * and the service has no reason to ship a PNG encoder. What this buys is a
 * basemap whose tiles STATE WHERE THEY ARE — every line is drawn at a round
 * EPSG:27700 coordinate computed from the tile's own ground extent — so
 * registration becomes provable rather than merely plausible: the vector
 * overlay draws the same round coordinates through the projector, and the two
 * must coincide exactly.
 *
 * It is better than a real OS tile for this, because the expected answer is
 * known exactly rather than eyeballed. It also needs no network and no API key,
 * so the proof runs in CI.
 */

import { deflateSync } from 'node:zlib'

import { gridIntervalMetres, tileSpanMetres, tileTopLeft } from './grid.js'

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
])
const BIT_DEPTH_8 = 8
const COLOUR_TYPE_RGB = 2
const CHANNELS = 3
const FILTER_NONE = 0
const IHDR_LENGTH = 13
const CRC_TABLE = buildCrcTable()

function buildCrcTable() {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
}

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/** A mutable RGB raster with just enough drawing to build a test basemap. */
class Raster {
  constructor(width, height, fill = [255, 255, 255]) {
    this.width = width
    this.height = height
    this.data = Buffer.alloc(width * height * CHANNELS)
    for (let i = 0; i < width * height; i++) {
      this.data[i * CHANNELS] = fill[0]
      this.data[i * CHANNELS + 1] = fill[1]
      this.data[i * CHANNELS + 2] = fill[2]
    }
  }

  set(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return
    }
    const i = (y * this.width + x) * CHANNELS
    this.data[i] = r
    this.data[i + 1] = g
    this.data[i + 2] = b
  }

  fillRect(x0, y0, w, h, colour) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        this.set(x, y, colour)
      }
    }
  }

  verticalLine(x, colour, width = 1) {
    this.fillRect(x, 0, width, this.height, colour)
  }

  horizontalLine(y, colour, width = 1) {
    this.fillRect(0, y, this.width, width, colour)
  }

  /** Encode to a PNG buffer. */
  toPng() {
    // Each scanline is prefixed with its filter byte; filter 0 = none.
    const stride = this.width * CHANNELS
    const raw = Buffer.alloc((stride + 1) * this.height)
    for (let y = 0; y < this.height; y++) {
      raw[y * (stride + 1)] = FILTER_NONE
      this.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
    }

    const ihdr = Buffer.alloc(IHDR_LENGTH)
    ihdr.writeUInt32BE(this.width, 0)
    ihdr.writeUInt32BE(this.height, 4)
    ihdr[8] = BIT_DEPTH_8
    ihdr[9] = COLOUR_TYPE_RGB
    ihdr[10] = 0 // compression: deflate
    ihdr[11] = 0 // filter method: adaptive
    ihdr[12] = 0 // interlace: none

    return Buffer.concat([
      PNG_SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0))
    ])
  }
}

const TILE_SHADE_A = [236, 240, 233]
const TILE_SHADE_B = [228, 234, 226]
const GRID_LINE = [176, 190, 176]
const MAJOR_LINE = [120, 140, 122]
const TILE_EDGE = [205, 214, 204]
const MAJOR_EVERY = 5
const ROUNDING_TOLERANCE = 1e-9

/**
 * A tile source whose tiles say where they are.
 *
 * The returned `interval` is the same number `gridIntervalMetres` gives the
 * overlay, from the same grid and zoom — never carried on the tile for the
 * overlay to read. A real OS tile has no such property, so an overlay that
 * reads it there works against this fixture and silently draws nothing against
 * the real thing.
 */
function syntheticTileSource() {
  return function synthetic(grid, z, col, row) {
    const span = tileSpanMetres(grid, z)
    const resolution = grid.resolutions[z]
    const [tileMinX, tileMaxY] = tileTopLeft(grid, z, col, row)
    const tileMaxX = tileMinX + span
    const tileMinY = tileMaxY - span

    // Alternate shading so tile seams are visible: a gap or an overlap between
    // neighbouring tiles shows up immediately as a light or dark line.
    const shade = (col + row) % 2 === 0 ? TILE_SHADE_A : TILE_SHADE_B
    const raster = new Raster(grid.tileSize, grid.tileSize, shade)

    const interval = gridIntervalMetres(resolution, grid.tileSize)
    const major = interval * MAJOR_EVERY

    for (
      let x = Math.ceil(tileMinX / interval) * interval;
      x <= tileMaxX;
      x += interval
    ) {
      const px = Math.round((x - tileMinX) / resolution)
      const isMajor = isMultipleOf(x, major)
      raster.verticalLine(px, isMajor ? MAJOR_LINE : GRID_LINE, isMajor ? 2 : 1)
    }

    for (
      let y = Math.ceil(tileMinY / interval) * interval;
      y <= tileMaxY;
      y += interval
    ) {
      // Northing increases upward; tile pixel rows increase downward.
      const py = Math.round((tileMaxY - y) / resolution)
      const isMajor = isMultipleOf(y, major)
      raster.horizontalLine(
        py,
        isMajor ? MAJOR_LINE : GRID_LINE,
        isMajor ? 2 : 1
      )
    }

    // Mark the tile's own edges, so a misplaced tile is obvious.
    raster.verticalLine(0, TILE_EDGE)
    raster.horizontalLine(0, TILE_EDGE)

    return { png: raster.toPng(), interval }
  }
}

function isMultipleOf(value, step) {
  return Math.abs(value / step - Math.round(value / step)) < ROUNDING_TOLERANCE
}

/**
 * A tile matrix set shaped like the one OS publishes for EPSG:27700: one shared
 * top-left origin, 256 px tiles, resolutions halving per level.
 *
 * The numbers are deliberately arbitrary and must never be promoted into
 * anything that talks to api.os.uk — the real grid comes from OS's own
 * GetCapabilities, and an origin out by one tile looks plausible while being
 * wrong.
 */
const TEST_GRID = Object.freeze({
  originX: -238375,
  originY: 1376256,
  tileSize: 256,
  resolutions: [
    896, 448, 224, 112, 56, 28, 14, 7, 3.5, 1.75, 0.875, 0.4375, 0.21875,
    0.109375
  ]
})

export { Raster, TEST_GRID, syntheticTileSource }
