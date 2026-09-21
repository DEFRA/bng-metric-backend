/**
 * Talking to api.os.uk.
 *
 * The only module that knows the API key exists. Everything downstream — the
 * browser, the report builder — sees an internal URL and nothing else.
 *
 * `fetch` is used deliberately rather than a bespoke HTTP client: on CDP it is
 * backed by undici, and `common/helpers/proxy/setup-proxy.js` — called from
 * `createServer` — installs the platform egress proxy with
 * `setGlobalDispatcher`, so plain `fetch` traverses it with no extra wiring.
 * This is the same reasoning NRF records in its own proxy.
 */

import {
  gridFromTileMatrixSetJson,
  gridFromWmtsCapabilities
} from '../report/pdf/grid.js'
import { OsTileError } from './errors.js'
import { isPlaceableImage } from './image-format.js'
import { DEFAULT_REQUEST_TIMEOUT_MS, TILE_MATRIX_SET } from './config.js'

/**
 * What each request calls itself when it fails.
 *
 * Named because one request says its own name three times — opening the
 * connection, reporting a refusal, and reading the answer — and three
 * spellings of the same request is three different diagnostics in a log.
 */
const WMTS_CAPABILITIES = 'WMTS GetCapabilities'
const TILE_MATRIX_SET_27700 = 'the 27700 tile matrix set'

/**
 * Fetch one raster tile.
 *
 * @param {{baseUrl: string, layer: string, apiKey: string}} config
 * @param {{z: number, col: number, row: number}} tile
 * @param {Function} [fetchImpl]
 * @returns {Promise<{ png: Buffer, contentType: string }>}
 */
async function fetchTile(config, { z, col, row }, fetchImpl = fetch) {
  const { baseUrl, layer, apiKey } = config
  // OS raster ZXY orders the path z/x/y, i.e. column then row.
  const url = `${baseUrl}/${layer}/${z}/${col}/${row}.png?key=${encodeURIComponent(apiKey)}`
  const response = await osFetch(
    url,
    `tile ${layer}/${z}/${col}/${row}`,
    config,
    fetchImpl
  )

  if (!response.ok) {
    throw upstreamError(response.status, `tile ${layer}/${z}/${col}/${row}`)
  }
  const what = `tile ${layer}/${z}/${col}/${row}`
  const png = await readUpstream(what, async () =>
    Buffer.from(await response.arrayBuffer())
  )

  // A 200 is not a tile. Something in front of api.os.uk can answer with an
  // HTML error page and a 200, and its `content-type` describes the page
  // rather than the truth — so check the bytes.
  //
  // Checked HERE, before the caller caches it, for two reasons beyond the
  // obvious: the cache holds tiles for a week by default, so one junk body
  // would poison every later report and browser tile until it expired; and
  // the tile routes would otherwise hand a browser an HTML page labelled
  // image/png. Raised in review on #297.
  if (!isPlaceableImage(png)) {
    throw new OsTileError(
      `Ordnance Survey's answer for ${what} was not a PNG or JPEG`,
      { status: HTTP_BAD_GATEWAY, upstream: true }
    )
  }

  return {
    png,
    contentType: response.headers.get('content-type') || 'image/png'
  }
}

/**
 * Fetch and parse the WMTS capabilities into a tile grid.
 *
 * This is the authoritative source for the EPSG:27700 origin and per-level
 * resolutions. Hard-coding them is the one thing guaranteed to produce a
 * basemap that looks plausible and is wrong, so this service fetches them and
 * serves them onward — which also means the report builder gets the real grid
 * without ever holding a key.
 *
 * @param {{wmtsUrl: string, apiKey: string}} config
 * @param {Function} [fetchImpl]
 * @param {string} [tileMatrixSet]
 * @returns {Promise<object>} the parsed tile matrix set
 */
async function fetchGrid(
  config,
  fetchImpl = fetch,
  tileMatrixSet = TILE_MATRIX_SET
) {
  const { wmtsUrl, apiKey } = config
  const url =
    `${wmtsUrl}?service=WMTS&request=GetCapabilities&version=2.0.0` +
    `&key=${encodeURIComponent(apiKey)}`
  const response = await osFetch(url, WMTS_CAPABILITIES, config, fetchImpl)

  if (!response.ok) {
    throw upstreamError(response.status, WMTS_CAPABILITIES)
  }
  return readUpstream(WMTS_CAPABILITIES, async () =>
    gridFromWmtsCapabilities(await response.text(), tileMatrixSet)
  )
}

/**
 * Fetch one vector tile from the OS NGD API – Tiles ngd-base tileset.
 *
 * NOTE the path order: OGC API Tiles is {tileMatrix}/{tileRow}/{tileCol} —
 * ROW before COLUMN — where the raster ZXY is z/x/y. Getting this wrong does
 * not error; it returns a plausible tile of somewhere else in Britain, which
 * is exactly the class of bug the registration proof exists to catch.
 *
 * @param {{vectorTilesUrl: string, apiKey: string}} config
 * @param {{z: number, col: number, row: number}} tile
 * @param {Function} [fetchImpl]
 * @returns {Promise<{ pbf: Buffer, contentType: string }>}
 */
async function fetchVectorTile(config, { z, col, row }, fetchImpl = fetch) {
  const { vectorTilesUrl, apiKey } = config
  const url = `${vectorTilesUrl}/${z}/${row}/${col}?key=${encodeURIComponent(apiKey)}`
  const response = await osFetch(
    url,
    `vector tile ${z}/${col}/${row}`,
    config,
    fetchImpl
  )

  if (!response.ok) {
    throw upstreamError(response.status, `vector tile ${z}/${col}/${row}`)
  }
  return {
    pbf: await readUpstream(`vector tile ${z}/${col}/${row}`, async () =>
      Buffer.from(await response.arrayBuffer())
    ),
    contentType: 'application/vnd.mapbox-vector-tile'
  }
}

/**
 * Fetch the EPSG:27700 tiling-scheme definition and parse it into a grid.
 *
 * Same policy as fetchGrid: the origin and resolutions come from OS's own
 * published document, never from a constant in this repo. The vector grid
 * DIFFERS from the raster one — 512 px tiles against 256, and two more
 * levels — which is why the two flavours publish separate grids.
 *
 * @param {{vectorTileMatrixSetUrl: string, apiKey: string}} config
 * @param {Function} [fetchImpl]
 * @returns {Promise<object>} the parsed tile matrix set
 */
async function fetchVectorGrid(config, fetchImpl = fetch) {
  const { vectorTileMatrixSetUrl, apiKey } = config
  const url = `${vectorTileMatrixSetUrl}?key=${encodeURIComponent(apiKey)}`
  const response = await osFetch(url, TILE_MATRIX_SET_27700, config, fetchImpl)

  if (!response.ok) {
    throw upstreamError(response.status, TILE_MATRIX_SET_27700)
  }
  return readUpstream(TILE_MATRIX_SET_27700, async () =>
    gridFromTileMatrixSetJson(await response.json())
  )
}

/**
 * The one call that leaves this process, with a deadline and a known failure
 * type.
 *
 * Two things it guarantees that a bare `fetchImpl` does not:
 *
 *  - **it ends.** A report fetches upwards of a hundred tiles, so a connection
 *    that hangs rather than fails costs the whole download and the request
 *    thread with it. undici's own defaults are measured in minutes.
 *  - **it fails as an `OsTileError`.** A transport failure — a reset, a DNS
 *    failure, this timeout — arrives from `fetch` as a `TypeError` or a
 *    `DOMException`, indistinguishable at the far end from a bug in the
 *    calling code. Wrapped, it degrades a report to a plain ground and gets a
 *    caller the same generic message as any other upstream failure; unwrapped,
 *    it would 500 a download over an unreachable basemap.
 *
 * The message keeps the upstream text for the log. `plugins/os-tiles.js` is
 * what decides that an upstream message is not repeated to a caller.
 */
async function osFetch(url, what, { requestTimeoutMs }, fetchImpl) {
  try {
    return await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(
        requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      )
    })
  } catch (error) {
    throw new OsTileError(
      `Could not reach Ordnance Survey for ${what}: ${error.message}`,
      { status: HTTP_BAD_GATEWAY, upstream: true, cause: error }
    )
  }
}

/**
 * Reading what came back, with the same two guarantees.
 *
 * The deadline covers the body as well as the headers, so it can fire
 * mid-stream; and a document that arrives but does not parse is an upstream
 * failure too, not a fault in this code. Either one, unwrapped, would 500 a
 * download that should have degraded to a plain ground.
 */
async function readUpstream(what, read) {
  try {
    return await read()
  } catch (error) {
    throw new OsTileError(
      `Could not read Ordnance Survey's answer for ${what}: ${error.message}`,
      { status: HTTP_BAD_GATEWAY, upstream: true, cause: error }
    )
  }
}

/**
 * Turn OS's two authentication-shaped failures into messages that say what to
 * do about them. They are NOT the same problem and were both observed live:
 *
 *   401  the key is unset/wrong, or its Data Hub project lacks the product
 *        THIS request needed — products are granted per-API, so a key can
 *        hold "OS NGD API – Tiles" (the vector flavour) and not
 *        "OS Maps API" (the raster one), or vice versa.
 *   403  the key is fine and the project is fine, but the *plan* does not
 *        cover this data. OS returns an OWS ExceptionReport reading
 *        "A Premium Plan is required to access Premium Data". On an OpenData
 *        plan this is what every EPSG:27700 raster tile above zoom 9
 *        returns, so the fix is usually OS_MAPS_MAX_ZOOM, not a new key.
 */
function upstreamError(status, what) {
  // `upstream: true` marks the message as operator-facing: it names the
  // environment variables to change and paraphrases what OS returned, neither
  // of which a caller of the tile routes is given — see plugins/os-tiles.js.
  return new OsTileError(messageFor(status, what), { status, upstream: true })
}

function messageFor(status, what) {
  if (status === HTTP_UNAUTHORIZED) {
    return (
      `Ordnance Survey rejected the request for ${what} (401). Either OS_API_KEY ` +
      `is unset or wrong, or its OS Data Hub project does not have the ${productFor(what)} ` +
      'product added — both fail this way.'
    )
  }
  if (status === HTTP_FORBIDDEN) {
    return (
      `Ordnance Survey returned 403 for ${what}: the key is valid but its plan does ` +
      'not cover this data ("A Premium Plan is required to access Premium Data"). ' +
      'An OpenData plan stops at zoom 9 in EPSG:27700 — set OS_MAPS_MAX_ZOOM=9 to ' +
      'stay inside it, or use a PSGA/Premium key for zooms 10-13.'
    )
  }
  return `Ordnance Survey returned ${status} for ${what}`
}

function productFor(what) {
  // Both vector requests — tiles and the tiling-scheme document — are the
  // same NGD product; only the raster route needs OS Maps API.
  if (what.startsWith('vector') || what.includes('tile matrix')) {
    return '"OS NGD API – Tiles"'
  }
  return '"OS Maps API"'
}

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_BAD_GATEWAY = 502

export { fetchGrid, fetchTile, fetchVectorGrid, fetchVectorTile }
