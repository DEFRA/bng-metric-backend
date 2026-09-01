/**
 * Configuration for the OS tiles service.
 *
 * The API key reaches here from convict (`config.get('osMaps.*')`) and goes no
 * further than `upstream.js`. Nothing else in the service — not the report
 * builder, not the browser map — ever sees it.
 */

const OS_MAPS_RASTER_ZXY = 'https://api.os.uk/maps/raster/v1/zxy'
const OS_MAPS_WMTS = 'https://api.os.uk/maps/raster/v1/wmts'

/**
 * The OS NGD API – Tiles `ngd-base` tileset, and the published 27700
 * tiling-scheme definition from the same API.
 *
 * This is a SEPARATE OS Data Hub product from the raster OS Maps API — a key
 * can hold either, both, or neither, which is why the report offers both
 * basemap flavours: the project key in hand has the NGD APIs but not
 * "OS Maps API". NGD Tiles is used rather than the older OS Vector Tile API
 * (`/vts`) because OS have marked that product for retirement; ngd-base
 * serves the same classic basemap layers at low zooms plus the NGD feature
 * themes (bld_fts_*, lnd_fts_*, str_fts_*, …) from z12 up, on the same
 * 27700 tile grid.
 */
const OS_NGD_TILES =
  'https://api.os.uk/maps/vector/ngd/ota/v1/collections/ngd-base/tiles/27700'
const OS_NGD_TILE_MATRIX_SET =
  'https://api.os.uk/maps/vector/ngd/ota/v1/tilematrixsets/27700'

/**
 * The deepest level the ngd-base tileset publishes (its tileset metadata
 * declares tileMatrixSetLimits 0-15, matching the 16-level tiling scheme).
 * A product property, not a deployment one — hence pinned, like OS_LAYERS.
 * No plan ceiling has been observed on the vector product: verified live
 * 2026-08-28, z0-15 all serve on a key whose raster requests 401.
 */
const OS_VECTOR_MAX_ZOOM = 15

/**
 * EPSG:27700 raster styles, and the zoom range OS publishes for each.
 *
 * Pinned in code rather than configured: these are properties of the OS
 * product, not deployment choices. `Leisure_27700` stops at 9, the rest at 13.
 */
const OS_LAYERS = Object.freeze({
  Light_27700: { maxZoom: 13 },
  Road_27700: { maxZoom: 13 },
  Outdoor_27700: { maxZoom: 13 },
  Leisure_27700: { maxZoom: 9 }
})

const DEFAULT_LAYER = 'Light_27700'

/**
 * British National Grid throughout, never reprojected.
 *
 * Every parcel is stored as `geometry(..., 27700)`, and the page transform is a
 * plain affine map from those metres to points. Serving tiles in EPSG:3857
 * would reintroduce a reprojection between the basemap and the geometry drawn
 * over it, which is exactly the class of error the transform exists to rule
 * out — and it buys no resolution (see OPEN_DATA_MAX_ZOOM).
 */
const TILE_MATRIX_SET = 'EPSG:27700'

/**
 * The zoom ceiling imposed by the OS *plan*, as distinct from the product.
 *
 * Measured against a live OpenData-plan key, not read off a doc page:
 * EPSG:27700 serves z0-9 and returns
 *
 *   403 <ExceptionText>A Premium Plan is required to access Premium Data</…>
 *
 * from z10 up, while GetCapabilities keeps succeeding — so the failure presents
 * as a tile problem rather than a licensing one. EPSG:3857 behaves the same way
 * with its own ceiling at z16, and z9 in 27700 (1.75 m/px) is no coarser than
 * z16 in 3857 at GB latitudes (~1.5 m/px), so reprojecting buys no detail and
 * costs exact registration.
 *
 * A PSGA / Premium key lifts this to the product maximum, which makes it a
 * deployment property. Hence `OS_MAPS_MAX_ZOOM`, and hence NOT defaulting it to
 * 9: defaulting to the free ceiling would silently throw away half the
 * resolution a Premium key has paid for.
 */
const OPEN_DATA_MAX_ZOOM = Object.freeze({
  'EPSG:27700': 9,
  'EPSG:3857': 16
})

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7
const SECONDS_PER_WEEK =
  SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY * DAYS_PER_WEEK

/** Tiles are static, so a fetched one is worth keeping for a long time. */
const DEFAULT_CACHE_TTL_SECONDS = SECONDS_PER_WEEK

/**
 * The tile cache's byte budget.
 *
 * catbox measures a memory cache in bytes rather than entries, which suits
 * tiles: a sparse rural raster tile is a couple of kilobytes and a dense urban
 * vector one is tens. One site map is around 30 tiles and a large site with
 * parcel thumbnails a few hundred, so 64 MB holds several whole reports.
 */
const BYTES_PER_MEGABYTE = 1024 * 1024
const DEFAULT_CACHE_MAX_BYTES = 64 * BYTES_PER_MEGABYTE

/**
 * Resolve the effective configuration, folding the plan ceiling into the
 * product ceiling.
 *
 * @param {object} overrides convict values, or explicit values in tests
 */
function resolveOsTilesConfig(overrides = {}) {
  const resolved = {
    apiKey: '',
    baseUrl: OS_MAPS_RASTER_ZXY,
    wmtsUrl: OS_MAPS_WMTS,
    vectorTilesUrl: OS_NGD_TILES,
    vectorTileMatrixSetUrl: OS_NGD_TILE_MATRIX_SET,
    vectorMaxZoom: OS_VECTOR_MAX_ZOOM,
    layer: DEFAULT_LAYER,
    cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
    cacheMaxBytes: DEFAULT_CACHE_MAX_BYTES,
    routePrefix: '/os-tiles',
    // Null means "whatever the product allows" — correct for a Premium/PSGA
    // key. An OpenData key must set OS_MAPS_MAX_ZOOM=9, or every tile above
    // that zoom 403s. `keyWarning` says so at startup. Raster only — no plan
    // ceiling has been observed on the vector product.
    maxZoom: null,
    ...overrides
  }

  if (!OS_LAYERS[resolved.layer]) {
    throw new Error(
      `Unknown OS layer "${resolved.layer}". Expected one of: ${Object.keys(
        OS_LAYERS
      ).join(', ')}`
    )
  }

  // The effective ceiling is the stricter of the product's and the plan's.
  const productMaxZoom = OS_LAYERS[resolved.layer].maxZoom
  resolved.maxZoom =
    resolved.maxZoom === null
      ? productMaxZoom
      : Math.min(resolved.maxZoom, productMaxZoom)

  return resolved
}

/**
 * The diagnostic grants-ui found necessary.
 *
 * A key that is unset — or set but whose OS Data Hub project does not have the
 * "OS Maps API" product added — produces a bare 401 from OS with nothing to
 * explain it. Say so once, loudly, at startup.
 */
function keyWarning({ apiKey }) {
  if (apiKey) {
    return null
  }
  return (
    'OS_API_KEY is not set: every tile request will fail as a 401 from ' +
    'Ordnance Survey with no diagnostic. Note the key must belong to an OS Data ' +
    'Hub project with the "OS Maps API" product added — a key without it 401s ' +
    'the same way.'
  )
}

export {
  DEFAULT_LAYER,
  OPEN_DATA_MAX_ZOOM,
  OS_LAYERS,
  OS_MAPS_RASTER_ZXY,
  OS_MAPS_WMTS,
  OS_NGD_TILES,
  OS_NGD_TILE_MATRIX_SET,
  OS_VECTOR_MAX_ZOOM,
  TILE_MATRIX_SET,
  keyWarning,
  resolveOsTilesConfig
}
