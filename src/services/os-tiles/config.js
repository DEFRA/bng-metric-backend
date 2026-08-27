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

/** One site map is around 30 tiles; a large site with thumbnails, a few hundred. */
const DEFAULT_CACHE_MAX_ENTRIES = 2000

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
    layer: DEFAULT_LAYER,
    cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
    cacheMaxEntries: DEFAULT_CACHE_MAX_ENTRIES,
    routePrefix: '/os-tiles',
    // Null means "whatever the product allows" — correct for a Premium/PSGA
    // key. An OpenData key must set OS_MAPS_MAX_ZOOM=9, or every tile above
    // that zoom 403s. `keyWarning` says so at startup.
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
    'OS_MAPS_API_KEY is not set: every tile request will fail as a 401 from ' +
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
  TILE_MATRIX_SET,
  keyWarning,
  resolveOsTilesConfig
}
