import Database from 'better-sqlite3'
import wkx from 'wkx'

import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

const EPSG_WGS84 = 4326
const EPSG_BNG = 27700
const SUPPORTED_SRIDS = new Set([EPSG_WGS84, EPSG_BNG])

// OGC GeoPackage 1.2 §2.1.3 — geometry blob header layout.
const GPKG_MAGIC_G = 0x47 // 'G'
const GPKG_MAGIC_P = 0x50 // 'P'
const GPKG_FLAGS_OFFSET = 3

// Aliases cover both the underscored canonical names and the QGIS display
// names with spaces. resolveTableName is case-insensitive, so spaces are the
// only thing that matters here.
const LAYER_ALIASES = {
  redline: [
    'red_line_boundary',
    'redline_boundary',
    'redline',
    'red_line',
    'red line boundary'
  ],
  areas: [
    'area_habitats',
    'baseline_area_habitats',
    'habitat_areas',
    'areas',
    'habitats'
  ],
  hedgerows: ['hedgerow_habitats', 'baseline_hedgerow_habitats', 'hedgerows'],
  watercourses: [
    'watercourse_habitats',
    'baseline_watercourse_habitats',
    'watercourses',
    'rivers'
  ],
  iggis: ['iggis', 'iggi', 'integrated_greening_grey_infrastructure'],
  trees: ['trees', 'baseline_trees', 'tree', 'urban trees']
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
 * GeoJSON Features in their native SRID (PostGIS reprojects to 27700 in-query).
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

  // QGIS-authored layer names contain spaces (e.g. "Red Line Boundary"), so the
  // identifier has to be double-quoted in the prepared SQL. PRAGMA and SELECT *
  // can't take bound parameters for object names, hence the inline quoting.
  const quotedTable = `"${tableName.replaceAll('"', '""')}"`

  // Discover non-geometry columns to attach as feature properties.
  const colRows = db.prepare(`PRAGMA table_info(${quotedTable})`).all()
  const propColumns = colRows.map((c) => c.name).filter((n) => n !== geomColumn)

  const rows = db.prepare(`SELECT * FROM ${quotedTable}`).all()
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

    const properties = {}
    for (const col of propColumns) {
      properties[col] = row[col]
    }

    features.push({
      type: 'Feature',
      properties,
      nativeGeometry: decoded.geometry,
      nativeSrid: featureSrid
    })
  }
  return { nativeSrid: tableSrid, features }
}

/**
 * Open a GeoPackage and return all layers we know about as GeoJSON Features
 * carrying their native geometry and SRID. PostGIS reprojects to 27700
 * in-query for area / containment checks.
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
