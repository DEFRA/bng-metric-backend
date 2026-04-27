import Database from 'better-sqlite3'

const { validateGpkg } = await import('./validate-gpkg.js')

// GeoPackage application IDs
const GP10_APP_ID = 0x47503130 // 1196437808 — GeoPackage 1.0
const GPKG_APP_ID = 0x47504b47 // 1196444487 — GeoPackage 1.2.1+

/**
 * Build a minimal GeoPackageBinary blob wrapping a WKB geometry.
 * Header: magic (GP), version (0), flags (little-endian, no envelope), srs_id (0).
 */
function makeGpkgBlob(wkbType) {
  const header = Buffer.from([0x47, 0x50, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00])
  const wkb = Buffer.allocUnsafe(5)
  wkb.writeUInt8(1, 0) // little-endian
  wkb.writeUInt32LE(wkbType, 1)
  return Buffer.concat([header, wkb])
}

const makePolygon = () => makeGpkgBlob(3) // WKB type 3 = Polygon
const makeLineString = () => makeGpkgBlob(2) // WKB type 2 = LineString
const makePoint = () => makeGpkgBlob(1) // WKB type 1 = Point

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
 */
function buildBuffer({
  appId = 0,
  systemTables = false,
  featureLayers = [],
  nonFeatureLayers = [],
  layerFeatures = {}
} = {}) {
  const db = new Database(':memory:')
  db.pragma(`application_id = ${appId}`)

  if (systemTables) {
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

    for (const layer of featureLayers) {
      db.exec(`CREATE TABLE "${layer}" (id INTEGER PRIMARY KEY, geom BLOB)`)
      db.prepare(
        `INSERT INTO gpkg_contents (table_name, data_type, identifier)
         VALUES (?, 'features', ?)`
      ).run(layer, layer)
      db.prepare(
        `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
         VALUES (?, 'geom', 'GEOMETRY', 4326, 0, 0)`
      ).run(layer)
      const geoms = layerFeatures[layer] ?? [makePolygon()]
      for (let i = 0; i < geoms.length; i++) {
        db.prepare(`INSERT INTO "${layer}" (id, geom) VALUES (?, ?)`).run(
          i + 1,
          geoms[i]
        )
      }
    }

    for (const layer of nonFeatureLayers) {
      db.exec(`CREATE TABLE "${layer}" (id INTEGER PRIMARY KEY)`)
      db.prepare(
        `INSERT INTO gpkg_contents (table_name, data_type, identifier)
         VALUES (?, 'tiles', ?)`
      ).run(layer, layer)
    }
  }

  const buffer = Buffer.from(db.serialize())
  db.close()
  return buffer
}

describe('validateGpkg', () => {
  describe('when the buffer is not a SQLite database', () => {
    it('returns invalid with a descriptive error', () => {
      const result = validateGpkg(Buffer.from('this is not a database'))

      expect(result).toEqual({
        valid: false,
        errors: ['File is not a valid GeoPackage']
      })
    })
  })

  describe('when the application_id is not a GeoPackage identifier', () => {
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

  describe('when required system tables are missing', () => {
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

  describe('when required feature layers are missing', () => {
    it('does not count layers registered with a non-features data_type', () => {
      const result = validateGpkg(
        buildBuffer({
          appId: GP10_APP_ID,
          systemTables: true,
          nonFeatureLayers: ['Red Line Boundary', 'Habitats']
        })
      )

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Missing required feature layer in GeoPackage: Red Line Boundary'
      )
      expect(result.errors).toContain(
        'Missing required feature layer in GeoPackage: Habitats'
      )
    })

    it('returns an error for each missing layer when none are present', () => {
      const result = validateGpkg(
        buildBuffer({ appId: GP10_APP_ID, systemTables: true })
      )

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Missing required feature layer in GeoPackage: Red Line Boundary'
      )
      expect(result.errors).toContain(
        'Missing required feature layer in GeoPackage: Habitats'
      )
    })

    it('returns an error only for the missing layer when one is present', () => {
      const result = validateGpkg(
        buildBuffer({
          appId: GP10_APP_ID,
          systemTables: true,
          featureLayers: ['Red Line Boundary']
        })
      )

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toBe(
        'Missing required feature layer in GeoPackage: Habitats'
      )
    })
  })

  describe('when the Red Line Boundary layer has an incorrect polygon count', () => {
    it('returns an error when there are no polygon features', () => {
      const result = validateGpkg(
        buildBuffer({
          appId: GP10_APP_ID,
          systemTables: true,
          featureLayers: ['Red Line Boundary', 'Habitats'],
          layerFeatures: { 'Red Line Boundary': [] }
        })
      )

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toBe(
        'Zero red line boundaries in GeoPackage (expecting one)'
      )
    })

    it('returns an error when the only features are non-polygon geometries', () => {
      const result = validateGpkg(
        buildBuffer({
          appId: GP10_APP_ID,
          systemTables: true,
          featureLayers: ['Red Line Boundary', 'Habitats'],
          layerFeatures: {
            'Red Line Boundary': [makeLineString(), makePoint()]
          }
        })
      )

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toBe(
        'Zero red line boundaries in GeoPackage (expecting one)'
      )
    })

    it('returns an error when there are multiple polygon features', () => {
      const result = validateGpkg(
        buildBuffer({
          appId: GP10_APP_ID,
          systemTables: true,
          featureLayers: ['Red Line Boundary', 'Habitats'],
          layerFeatures: {
            'Red Line Boundary': [makePolygon(), makePolygon()]
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
          featureLayers: ['Red Line Boundary', 'Habitats'],
          layerFeatures: {
            'Red Line Boundary': [makePolygon(), makeLineString()]
          }
        })
      )

      expect(result).toEqual({ valid: true, errors: [] })
    })
  })

  describe('when the GeoPackage is fully valid', () => {
    it('returns valid with no errors for a GP10 (v1.0) GeoPackage', () => {
      const result = validateGpkg(
        buildBuffer({
          appId: GP10_APP_ID,
          systemTables: true,
          featureLayers: ['Red Line Boundary', 'Habitats']
        })
      )

      expect(result).toEqual({ valid: true, errors: [] })
    })

    it('returns valid with no errors for a GPKG (v1.2.1+) GeoPackage', () => {
      const result = validateGpkg(
        buildBuffer({
          appId: GPKG_APP_ID,
          systemTables: true,
          featureLayers: ['Red Line Boundary', 'Habitats']
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
})
