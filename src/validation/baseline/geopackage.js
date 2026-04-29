import Database from 'better-sqlite3'
import wkx from 'wkx'
import proj4 from 'proj4'

import { createLogger } from '../../common/helpers/logging/logger.js'

// MERGE NOTE (PR #16): runs after that PR's validateGpkg format gate. Long
// term, collapse both readers into a single SQLite open pass.

const logger = createLogger()

// British National Grid — not in proj4's default set.
proj4.defs(
  'EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs +type=crs'
)

const EPSG_WGS84 = 4326
const EPSG_BNG = 27700
const SUPPORTED_SRIDS = new Set([EPSG_WGS84, EPSG_BNG])

// OGC GeoPackage 1.2 §2.1.3 — geometry blob header layout.
const GPKG_MAGIC_G = 0x47 // 'G'
const GPKG_MAGIC_P = 0x50 // 'P'
const GPKG_FLAGS_OFFSET = 3

const LAYER_ALIASES = {
  redline: ['red_line_boundary', 'redline_boundary', 'redline', 'red_line'],
  areas: ['area_habitats', 'baseline_area_habitats', 'habitat_areas', 'areas'],
  hedgerows: ['hedgerow_habitats', 'baseline_hedgerow_habitats', 'hedgerows'],
  watercourses: [
    'watercourse_habitats',
    'baseline_watercourse_habitats',
    'watercourses'
  ],
  iggis: ['iggis', 'iggi', 'integrated_greening_grey_infrastructure'],
  trees: ['trees', 'baseline_trees', 'tree']
}

/**
 * Decode a GeoPackage geometry blob into a wkx Geometry.
 * Header format per OGC GeoPackage 1.2 §2.1.3.
 *
 * @param {Buffer} blob
 * @returns {{ geometry: object, srsId: number } | null}
 */
function decodeGpkgBlob(blob) {
  if (!blob || blob.length < 8) {
    return null
  }
  if (blob[0] !== GPKG_MAGIC_G || blob[1] !== GPKG_MAGIC_P) {
    throw new Error('Invalid GeoPackage geometry blob: bad magic')
  }
  const flags = blob[GPKG_FLAGS_OFFSET]
  const envelopeIndicator = (flags >> 1) & 0x07
  const envelopeBytes = { 0: 0, 1: 32, 2: 48, 3: 48, 4: 64 }[envelopeIndicator]
  if (envelopeBytes === undefined) {
    throw new Error(
      `Invalid GeoPackage envelope indicator: ${envelopeIndicator}`
    )
  }
  const isLittleEndian = (flags & 0x01) === 1
  const srsId = isLittleEndian ? blob.readInt32LE(4) : blob.readInt32BE(4)
  const wkb = blob.subarray(8 + envelopeBytes)
  const parsed = wkx.Geometry.parse(wkb)
  return { geometry: parsed.toGeoJSON(), srsId }
}

/**
 * Reproject a single coordinate pair (mutating helper avoided).
 */
function reprojectCoord(coord, transformer) {
  const [x, y] = transformer.forward([coord[0], coord[1]])
  return coord.length > 2 ? [x, y, coord[2]] : [x, y]
}

/**
 * Walk a GeoJSON geometry's coordinates and apply a transform.
 * Returns a new geometry object; the input is not mutated.
 */
function reprojectGeometry(geom, transformer) {
  const map = (coords, level) => {
    if (level === 0) {
      return reprojectCoord(coords, transformer)
    }
    return coords.map((c) => map(c, level - 1))
  }
  const depthByType = {
    Point: 0,
    LineString: 1,
    Polygon: 2,
    MultiPoint: 1,
    MultiLineString: 2,
    MultiPolygon: 3
  }
  if (geom.type === 'GeometryCollection') {
    return {
      type: 'GeometryCollection',
      geometries: geom.geometries.map((g) => reprojectGeometry(g, transformer))
    }
  }
  const depth = depthByType[geom.type]
  if (depth === undefined) {
    throw new Error(`Unsupported geometry type: ${geom.type}`)
  }
  return {
    type: geom.type,
    coordinates: map(geom.coordinates, depth)
  }
}

/**
 * Match a logical layer name (e.g. 'redline') to a real table name in the
 * GeoPackage, using the alias list. Case-insensitive.
 */
function resolveTableName(logicalName, availableTables) {
  const aliases = LAYER_ALIASES[logicalName] ?? [logicalName]
  const lower = new Map(availableTables.map((t) => [t.toLowerCase(), t]))
  for (const alias of aliases) {
    const hit = lower.get(alias.toLowerCase())
    if (hit) {
      return hit
    }
  }
  return null
}

/**
 * Read all features from a single GeoPackage feature table, returning them as
 * GeoJSON Features in WGS84 (EPSG:4326) plus the original native SRID.
 */
function readLayer(db, tableName) {
  const geomColumnRow = db
    .prepare(
      'SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?'
    )
    .get(tableName)
  if (!geomColumnRow) {
    return { nativeSrid: null, features: [] }
  }

  const { column_name: geomColumn, srs_id: tableSrid } = geomColumnRow

  // Discover non-geometry columns to attach as feature properties.
  const colRows = db.prepare(`PRAGMA table_info(${tableName})`).all()
  const propColumns = colRows.map((c) => c.name).filter((n) => n !== geomColumn)

  const rows = db.prepare(`SELECT * FROM ${tableName}`).all()
  const features = []
  for (const row of rows) {
    const blob = row[geomColumn]
    const decoded = decodeGpkgBlob(blob)
    if (!decoded) {
      continue
    }

    const featureSrid = decoded.srsId || tableSrid
    if (!SUPPORTED_SRIDS.has(featureSrid)) {
      throw new Error(
        `Unsupported SRID ${featureSrid} in table ${tableName}. ` +
          `Supported: ${[...SUPPORTED_SRIDS].join(', ')}.`
      )
    }

    const geometry =
      featureSrid === EPSG_WGS84
        ? decoded.geometry
        : reprojectGeometry(
            decoded.geometry,
            proj4(`EPSG:${featureSrid}`, `EPSG:${EPSG_WGS84}`)
          )

    const properties = {}
    for (const col of propColumns) {
      properties[col] = row[col]
    }

    features.push({
      type: 'Feature',
      properties,
      geometry,
      // Preserve native geometry too, so area maths can run in projected
      // metres without a round-trip through WGS84.
      nativeGeometry: decoded.geometry,
      nativeSrid: featureSrid
    })
  }
  return { nativeSrid: tableSrid, features }
}

/**
 * Open a GeoPackage and return all layers we know about as GeoJSON Features
 * (in WGS84). Each feature also carries its native (un-reprojected) geometry
 * and SRID for area calculations.
 *
 * @param {string} filePath
 * @returns {{
 *   redline: object[],
 *   areas: object[],
 *   hedgerows: object[],
 *   watercourses: object[],
 *   iggis: object[],
 *   trees: object[],
 *   missingLayers: string[]
 * }}
 */
export function readBaselineGeoPackage(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const tables = db
      .prepare(
        "SELECT table_name FROM gpkg_contents WHERE data_type = 'features'"
      )
      .all()
      .map((r) => r.table_name)

    logger.info(
      `readBaselineGeoPackage - file: ${filePath}, feature tables: ${JSON.stringify(tables)}`
    )

    const result = {
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: [],
      missingLayers: []
    }

    for (const logical of Object.keys(LAYER_ALIASES)) {
      const table = resolveTableName(logical, tables)
      if (!table) {
        result.missingLayers.push(logical)
        continue
      }
      result[logical] = readLayer(db, table).features
    }

    return result
  } finally {
    db.close()
  }
}
