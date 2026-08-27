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

// The eight-byte PNG signature, from the spec: a high bit to catch 7-bit
// transports, "PNG" in ASCII, then a CRLF/EOF/LF sequence that detects a
// transfer having mangled line endings.
const PNG_SIGNATURE = Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')
const BIT_DEPTH_8 = 8
const COLOUR_TYPE_RGB = 2
const CHANNELS = 3
const CHANNEL_MASK = 0xff
const RED_SHIFT = 16
const GREEN_SHIFT = 8
const FILTER_NONE = 0
const IHDR_LENGTH = 13
// Byte offsets within IHDR, and the only values this encoder ever writes.
const IHDR_BIT_DEPTH = 8
const IHDR_COLOUR_TYPE = 9
const IHDR_COMPRESSION = 10
const IHDR_FILTER = 11
const IHDR_INTERLACE = 12
const COMPRESSION_DEFLATE = 0
const FILTER_METHOD_ADAPTIVE = 0
const INTERLACE_NONE = 0
const DEFLATE_MAX_LEVEL = 9
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

const WHITE = '#ffffff'

/**
 * `#rrggbb` → the three channel bytes the raster stores.
 *
 * Colours are written as hex here for the same reason `document.js` writes them
 * that way: it is the spelling a designer recognises, and one string beats three
 * numbers that have to be read together to mean anything.
 */
function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    (value >> RED_SHIFT) & CHANNEL_MASK,
    (value >> GREEN_SHIFT) & CHANNEL_MASK,
    value & CHANNEL_MASK
  ]
}

/** A mutable RGB raster with just enough drawing to build a test basemap. */
class Raster {
  constructor(width, height, fill = rgb(WHITE)) {
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
    ihdr[IHDR_BIT_DEPTH] = BIT_DEPTH_8
    ihdr[IHDR_COLOUR_TYPE] = COLOUR_TYPE_RGB
    ihdr[IHDR_COMPRESSION] = COMPRESSION_DEFLATE
    ihdr[IHDR_FILTER] = FILTER_METHOD_ADAPTIVE
    ihdr[IHDR_INTERLACE] = INTERLACE_NONE

    return Buffer.concat([
      PNG_SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: DEFLATE_MAX_LEVEL })),
      chunk('IEND', Buffer.alloc(0))
    ])
  }
}

const TILE_SHADE_A = rgb('#ecf0e9')
const TILE_SHADE_B = rgb('#e4eae2')
const GRID_LINE = rgb('#b0beb0')
const MAJOR_LINE = rgb('#788c7a')
const TILE_EDGE = rgb('#cdd6cc')
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
// One shared top-left origin, 256 px tiles, and resolutions that halve per
// level. Generated rather than hand-typed so the halving is stated as the rule
// it is — a typo in a copied list of fourteen numbers is invisible.
const TEST_GRID_ORIGIN_X = -238375
const TEST_GRID_ORIGIN_Y = 1376256
const TEST_GRID_TILE_SIZE = 256
const TEST_GRID_BASE_RESOLUTION = 896
const TEST_GRID_LEVELS = 14

const TEST_GRID = Object.freeze({
  originX: TEST_GRID_ORIGIN_X,
  originY: TEST_GRID_ORIGIN_Y,
  tileSize: TEST_GRID_TILE_SIZE,
  resolutions: Object.freeze(
    Array.from(
      { length: TEST_GRID_LEVELS },
      (_, z) => TEST_GRID_BASE_RESOLUTION / 2 ** z
    )
  )
})

export { Raster, TEST_GRID, syntheticTileSource }
