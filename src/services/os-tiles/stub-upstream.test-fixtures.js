/**
 * A stand-in for api.os.uk.
 *
 * Returns a `fetch`-compatible function, so it substitutes at exactly the seam
 * the CDP egress proxy uses — no HTTP server, no network, no key. Everything
 * under test is the code that would ship; only the upstream is fake.
 *
 * The tiles it serves are the SAME self-describing tiles the registration proof
 * uses: each draws a grid at round EPSG:27700 coordinates. So a tile returned
 * for the wrong z/col/row, or coordinates mangled in transit, would show up as
 * an overlay that no longer lines up.
 */

import {
  TEST_GRID,
  stubTileMatrixSetJson,
  syntheticTileSource,
  syntheticVectorTile
} from '../report/pdf/synthetic-tiles.test-fixtures.js'

const HTTP_OK = 200
const HTTP_REDIRECTION = 300
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404
const OGC_STANDARD_PIXEL_METRES = 0.00028
const GB_EXTENT_METRES = 1_400_000

/**
 * A capabilities document with the same shape OS publishes for EPSG:27700: one
 * shared top-left origin, 256 px tiles, resolutions halving per level, and
 * per-level MatrixWidth/MatrixHeight which — unlike Web Mercator's — are not
 * 2^z square.
 */
function stubCapabilities(grid, tileMatrixSetId = 'EPSG:27700') {
  const levels = grid.resolutions
    .map((resolution, z) => {
      const scaleDenominator = resolution / OGC_STANDARD_PIXEL_METRES
      const width =
        grid.matrixWidths?.[z] ??
        Math.ceil(GB_EXTENT_METRES / (resolution * grid.tileSize))
      const height = grid.matrixHeights?.[z] ?? width
      return `
        <TileMatrix>
          <ows:Identifier>${z}</ows:Identifier>
          <ScaleDenominator>${scaleDenominator}</ScaleDenominator>
          <TopLeftCorner>${grid.originX} ${grid.originY}</TopLeftCorner>
          <TileWidth>${grid.tileSize}</TileWidth>
          <TileHeight>${grid.tileSize}</TileHeight>
          <MatrixWidth>${width}</MatrixWidth>
          <MatrixHeight>${height}</MatrixHeight>
        </TileMatrix>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns:ows="http://www.opengis.net/ows/1.1">
  <Contents>
    <TileMatrixSet>
      <ows:Identifier>${tileMatrixSetId}</ows:Identifier>
      ${levels}
    </TileMatrixSet>
  </Contents>
</Capabilities>`
}

function textResponse(body, contentType, status = HTTP_OK) {
  return {
    ok: status >= HTTP_OK && status < HTTP_REDIRECTION,
    status,
    statusText: status === HTTP_OK ? 'OK' : 'Error',
    headers: { get: (name) => (name === 'content-type' ? contentType : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => Buffer.from(body)
  }
}

function binaryResponse(buffer, contentType) {
  return {
    ok: true,
    status: HTTP_OK,
    statusText: 'OK',
    headers: { get: (name) => (name === 'content-type' ? contentType : null) },
    text: async () => buffer.toString('latin1'),
    arrayBuffer: async () => buffer
  }
}

function errorResponse(status, message) {
  return {
    ok: false,
    status,
    statusText: message,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ error: message }),
    arrayBuffer: async () => Buffer.from(JSON.stringify({ error: message }))
  }
}

const TILE_PATH = /\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.png$/

// OGC API Tiles orders the path {tileMatrix}/{tileRow}/{tileCol} — ROW before
// COLUMN — where the raster ZXY is z/x/y. The stub mirrors the real ngd-base
// URL shape so a swapped row/col in upstream.js fails here, not in the field.
const VECTOR_TILE_PATH = /\/tiles\/27700\/(\d+)\/(\d+)\/(\d+)$/

/**
 * @param {object} [grid]  the tile matrix the stub should claim to have
 * @param {object} [options]
 * @param {string} [options.expectKey]  reject requests without this key, the
 *   way OS rejects one whose Data Hub project lacks the OS Maps API product
 * @returns {{ fetch: Function, calls: string[] }}
 */
function stubOsFetch(grid = TEST_GRID, { expectKey = null } = {}) {
  const tile = syntheticTileSource()
  const calls = []

  async function stubFetch(url) {
    const parsed = new URL(url)
    calls.push(parsed.pathname + parsed.search)

    if (expectKey && parsed.searchParams.get('key') !== expectKey) {
      return errorResponse(HTTP_UNAUTHORIZED, 'Unauthorized')
    }

    if (parsed.searchParams.get('request') === 'GetCapabilities') {
      return textResponse(stubCapabilities(grid), 'application/xml')
    }

    if (parsed.pathname.includes('/tilematrixsets/')) {
      return textResponse(
        JSON.stringify(stubTileMatrixSetJson(grid)),
        'application/json'
      )
    }

    const vectorMatch = VECTOR_TILE_PATH.exec(parsed.pathname)
    if (vectorMatch) {
      const [, z, row, col] = vectorMatch
      const pbf = syntheticVectorTile(grid, Number(z), Number(col), Number(row))
      return binaryResponse(pbf, 'application/vnd.mapbox-vector-tile')
    }

    const match = TILE_PATH.exec(parsed.pathname)
    if (!match) {
      return errorResponse(
        HTTP_NOT_FOUND,
        `Stub has no route for ${parsed.pathname}`
      )
    }

    const [, z, col, row] = match
    const { png } = tile(grid, Number(z), Number(col), Number(row))
    return binaryResponse(png, 'image/png')
  }

  return { fetch: stubFetch, calls }
}

export { stubCapabilities, stubOsFetch }
