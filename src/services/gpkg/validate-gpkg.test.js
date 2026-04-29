import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'

const { validateGpkg } = await import('./validate-gpkg.js')

// GeoPackage application IDs
const GP10_APP_ID = 0x47503130 // 1196437808 — GeoPackage 1.0
const GPKG_APP_ID = 0x47504b47 // 1196444487 — GeoPackage 1.2.1+

// Required layer names
const LAYER_RLB = 'Red Line Boundary'
const LAYER_HABITATS = 'Habitats'
const ALL_LAYERS = [LAYER_RLB, LAYER_HABITATS]

const missingLayerError = (name) =>
  `Missing required feature layer in GeoPackage: ${name}`
const ERR_ZERO_RLB = 'Zero red line boundaries in GeoPackage (expecting one)'
const ERR_UNREADABLE_RLB = 'Red Line Boundary contains unreadable geometry'

// GeoPackageBinary magic bytes ('G', 'P')
const GPKG_MAGIC_BYTE_G = 0x47
const GPKG_MAGIC_BYTE_P = 0x50

// WKB geometry type codes
const WKB_TYPE_POLYGON = 3
const WKB_TYPE_LINE_STRING = 2
const WKB_TYPE_POINT = 1

// Minimum size of a WKB payload (1-byte endian + 4-byte type)
const WKB_HEADER_BYTES = 5

/**
 * Build a minimal GeoPackageBinary blob wrapping a WKB geometry.
 * Header: magic (GP), version (0), flags (little-endian, no envelope), srs_id (0).
 */
function makeGpkgBlob(wkbType) {
  const header = Buffer.from([
    GPKG_MAGIC_BYTE_G,
    GPKG_MAGIC_BYTE_P,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00
  ])
  const wkb = Buffer.allocUnsafe(WKB_HEADER_BYTES)
  wkb.writeUInt8(1, 0) // little-endian
  wkb.writeUInt32LE(wkbType, 1)
  return Buffer.concat([header, wkb])
}

const makePolygon = () => makeGpkgBlob(WKB_TYPE_POLYGON)
const makeLineString = () => makeGpkgBlob(WKB_TYPE_LINE_STRING)
const makePoint = () => makeGpkgBlob(WKB_TYPE_POINT)

// too short to parse — only the 2-byte magic prefix
const makeCorruptBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P])

// Envelope indicator 5 is out of range (GPKG_ENVELOPE_SIZES only covers 0–4)
const makeInvalidEnvelopeBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00]) // prettier-ignore

// Envelope indicator 1 signals a 32-byte envelope, but the blob ends at byte 8,
// leaving no room for the WKB payload (needs at least 45 bytes total)
const makeTruncatedEnvelopeBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]) // prettier-ignore

/**
 * Build a SQLite database in-memory, optionally configure it as a
 * GeoPackage, then serialize it to a Buffer for use with validateGpkg.
 *
 * @param {object} [opts]
 * @param {number}   [opts.appId=0]
 * @param {boolean}  [opts.systemTables=false]
 * @param {string[]} [opts.featureLayers=[]]
 * @param {string[]} [opts.nonFeatureLayers=[]]
 * @param {Record<string, Buffer[]>} [opts.layerFeatures={}]
 *   Map of layer name to array of geometry blobs to insert.
 *   Defaults to one polygon per layer when not specified.
 * @param {string|null} [opts.rlbGeomColumnName]
 *   Override the geometry column name registered for Red Line Boundary in
 *   gpkg_geometry_columns. Set to null to omit the row entirely.
 *   Defaults to 'geom' (same as all other feature layers).
 */
function buildBuffer({
  appId = 0,
  systemTables = false,
  featureLayers = [],
  nonFeatureLayers = [],
  layerFeatures = {},
  rlbGeomColumnName = 'geom'
} = {}) {
  const db = new Database(':memory:')
  db.pragma(`application_id = ${appId}`)

  if (systemTables) {
    createSystemTables(db)
    insertFeatureLayers(db, featureLayers, layerFeatures, rlbGeomColumnName)
    insertNonFeatureLayers(db, nonFeatureLayers)
  }

  const buffer = Buffer.from(db.serialize())
  db.close()
  return buffer
}

function createSystemTables(db) {
  db.exec(`
    CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL,
      description TEXT
    )
  `)
  db.exec(`
    CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT UNIQUE,
      description TEXT DEFAULT '',
      last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      min_x REAL, min_y REAL, max_x REAL, max_y REAL,
      srs_id INTEGER
    )
  `)
  db.exec(`
    CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL,
      m TINYINT NOT NULL,
      CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name)
    )
  `)
}

function insertFeatureLayers(
  db,
  featureLayers,
  layerFeatures,
  rlbGeomColumnName
) {
  for (const layer of featureLayers) {
    db.exec(`CREATE TABLE "${layer}" (id INTEGER PRIMARY KEY, geom BLOB)`)
    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier)
       VALUES (?, 'features', ?)`
    ).run(layer, layer)
    const colName =
      layer.toLowerCase() === 'red line boundary' &&
      rlbGeomColumnName !== 'geom'
        ? rlbGeomColumnName
        : 'geom'
    if (colName !== null) {
      db.prepare(
        `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
         VALUES (?, ?, 'GEOMETRY', 4326, 0, 0)`
      ).run(layer, colName)
    }
    const geoms = layerFeatures[layer] ?? [makePolygon()]
    for (let i = 0; i < geoms.length; i++) {
      db.prepare(`INSERT INTO "${layer}" (id, geom) VALUES (?, ?)`).run(
        i + 1,
        geoms[i]
      )
    }
  }
}

function insertNonFeatureLayers(db, nonFeatureLayers) {
  for (const layer of nonFeatureLayers) {
    db.exec(`CREATE TABLE "${layer}" (id INTEGER PRIMARY KEY)`)
    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier)
       VALUES (?, 'tiles', ?)`
    ).run(layer, layer)
  }
}

describe('validateGpkg when the buffer is not a SQLite database', () => {
  it('returns invalid with a descriptive error', () => {
    const result = validateGpkg(Buffer.from('this is not a database'))

    expect(result).toEqual({
      valid: false,
      errors: ['File is not a valid GeoPackage']
    })
  })
})

describe('validateGpkg when the application_id is not a GeoPackage identifier', () => {
  it('returns invalid with a descriptive error for application_id 0', () => {
    const result = validateGpkg(buildBuffer({ appId: 0 }))

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(
      /application_id 0x0 is not a recognised GeoPackage identifier/
    )
  })

  it('returns invalid with a descriptive error for an arbitrary wrong id', () => {
    const result = validateGpkg(buildBuffer({ appId: 12345 }))

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(
      /application_id.*is not a recognised GeoPackage identifier/
    )
  })
})

describe('validateGpkg when required system tables are missing', () => {
  it('returns an error for each missing system table', () => {
    const result = validateGpkg(buildBuffer({ appId: GP10_APP_ID }))

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Missing required GeoPackage system table: gpkg_contents'
    )
    expect(result.errors).toContain(
      'Missing required GeoPackage system table: gpkg_geometry_columns'
    )
    expect(result.errors).toContain(
      'Missing required GeoPackage system table: gpkg_spatial_ref_sys'
    )
  })

  it('reports only the missing table when two of three system tables are present', () => {
    const db = new Database(':memory:')
    db.pragma(`application_id = ${GP10_APP_ID}`)
    db.exec(
      'CREATE TABLE gpkg_spatial_ref_sys (srs_id INTEGER NOT NULL PRIMARY KEY, srs_name TEXT NOT NULL, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT)'
    )
    db.exec(
      "CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x REAL, min_y REAL, max_x REAL, max_y REAL, srs_id INTEGER)"
    )
    // gpkg_geometry_columns intentionally omitted
    const buffer = Buffer.from(db.serialize())
    db.close()

    const result = validateGpkg(buffer)

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(
      'Missing required GeoPackage system table: gpkg_geometry_columns'
    )
  })
})

describe('validateGpkg when required feature layers are missing', () => {
  it('does not count layers registered with a non-features data_type', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        nonFeatureLayers: ALL_LAYERS
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(missingLayerError(LAYER_RLB))
    expect(result.errors).toContain(missingLayerError(LAYER_HABITATS))
  })

  it('returns an error for each missing layer when none are present', () => {
    const result = validateGpkg(
      buildBuffer({ appId: GP10_APP_ID, systemTables: true })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(missingLayerError(LAYER_RLB))
    expect(result.errors).toContain(missingLayerError(LAYER_HABITATS))
  })

  it('returns an error only for the missing layer when one is present', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: [LAYER_RLB]
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(missingLayerError(LAYER_HABITATS))
  })
})

describe('validateGpkg when the Red Line Boundary geometry column is missing or invalid', () => {
  it('returns a descriptive error when there is no registered geometry column', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        rlbGeomColumnName: null
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(
      'Red Line Boundary layer has no registered geometry column in gpkg_geometry_columns'
    )
  })

  it('returns a descriptive error for a column name that fails the identifier check', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        rlbGeomColumnName: 'geom"; DROP TABLE "Red Line Boundary"; --'
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(
      'Red Line Boundary geometry column has an invalid name in gpkg_geometry_columns'
    )
  })
})

describe('validateGpkg when the Red Line Boundary layer has an incorrect polygon count', () => {
  it('returns an error when there are no polygon features', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: { [LAYER_RLB]: [] }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(ERR_ZERO_RLB)
  })

  it('returns an error when the only features are non-polygon geometries', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makeLineString(), makePoint()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(ERR_ZERO_RLB)
  })

  it('returns an error when there are multiple polygon features', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makePolygon(), makePolygon()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(
      'Too many red line boundaries in GeoPackage (expecting one)'
    )
  })

  it('does not count non-polygon rows towards the polygon total', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makePolygon(), makeLineString()]
        }
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })
})

describe('validateGpkg when the Red Line Boundary layer contains unreadable geometry', () => {
  it('returns an error when any geometry blob is unreadable', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makePolygon(), makeCorruptBlob()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe(ERR_UNREADABLE_RLB)
  })

  it('does not also report a polygon count error when geometry is unreadable', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makeCorruptBlob()]
        }
      })
    )

    expect(result.errors).not.toContain(ERR_ZERO_RLB)
    expect(result.errors).toContain(ERR_UNREADABLE_RLB)
  })

  it('treats a blob with an out-of-range envelope indicator as unreadable', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makeInvalidEnvelopeBlob()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(ERR_UNREADABLE_RLB)
  })

  it('treats a blob too short for its declared envelope as unreadable', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makeTruncatedEnvelopeBlob()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(ERR_UNREADABLE_RLB)
  })
})

describe('validateGpkg when the GeoPackage is fully valid', () => {
  it('returns valid with no errors for a GP10 (v1.0) GeoPackage', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('returns valid with no errors for a GPKG (v1.2.1+) GeoPackage', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GPKG_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('matches layer names case-insensitively', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ['RED LINE BOUNDARY', 'HABITATS']
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })
})
