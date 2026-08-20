import { describe, it, expect, afterAll } from 'vitest'
import Database from 'better-sqlite3'

import { ERROR_CODES, makeError } from './errors.js'
import {
  ALL_LAYERS,
  ERR_UNREADABLE_RLB,
  ERR_ZERO_RLB,
  GP10_APP_ID,
  GPKG_APP_ID,
  LAYER_HABITATS,
  LAYER_RLB,
  buildBuffer,
  buildWalModeBuffer,
  mutateSerializedBuffer,
  makeCorruptBlob,
  makeInvalidEnvelopeBlob,
  makeLineString,
  makePoint,
  makePolygon,
  makeTruncatedEnvelopeBlob,
  missingLayerError,
  removeStagedGpkgFiles,
  stageGpkgFile
} from '../../../test/helpers/gpkg.js'

const { validateAndReadGpkg } = await import('./geopackage.js')

/**
 * These are format-gate tests: they build a fixture in memory, stage it to a
 * file the way the upload route now does (BMD-913), and assert on the gate
 * verdict alone. The parsed layers are covered by validate-and-read-gpkg.test.js.
 */
function gateBuffer(buffer) {
  const { valid, errors } = validateAndReadGpkg(stageGpkgFile(buffer))
  return { valid, errors }
}

afterAll(removeStagedGpkgFiles)

describe('format gate when the file is not a SQLite database', () => {
  it('returns invalid with a descriptive error', () => {
    const result = gateBuffer(Buffer.from('this is not a database'))

    expect(result).toEqual({
      valid: false,
      errors: [
        makeError(
          ERROR_CODES.GPKG_INVALID_FILE,
          'File is not a valid GeoPackage'
        )
      ]
    })
  })
})

describe('format gate when the application_id is not a GeoPackage identifier', () => {
  it('returns invalid with a descriptive error for application_id 0', () => {
    const result = gateBuffer(buildBuffer({ appId: 0 }))

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(
      /application_id 0x0 is not a recognised GeoPackage identifier/
    )
  })

  it('returns invalid with a descriptive error for an arbitrary wrong id', () => {
    const result = gateBuffer(buildBuffer({ appId: 12345 }))

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toMatch(
      /application_id.*is not a recognised GeoPackage identifier/
    )
  })
})

describe('format gate when required system tables are missing', () => {
  it('returns an error for each missing system table', () => {
    const result = gateBuffer(buildBuffer({ appId: GP10_APP_ID }))

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.message)).toContain(
      'Missing required GeoPackage system table: gpkg_contents'
    )
    expect(result.errors.map((e) => e.message)).toContain(
      'Missing required GeoPackage system table: gpkg_geometry_columns'
    )
    expect(result.errors.map((e) => e.message)).toContain(
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

    const result = gateBuffer(buffer)

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toBe(
      'Missing required GeoPackage system table: gpkg_geometry_columns'
    )
  })
})

describe('format gate when required feature layers are missing', () => {
  it('does not count layers registered with a non-features data_type', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        nonFeatureLayers: ALL_LAYERS
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.message)).toContain(
      missingLayerError(LAYER_RLB).message
    )
    expect(result.errors.map((e) => e.message)).toContain(
      missingLayerError(LAYER_HABITATS).message
    )
  })

  it('returns an error for each missing layer when none are present', () => {
    const result = gateBuffer(
      buildBuffer({ appId: GP10_APP_ID, systemTables: true })
    )

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.message)).toContain(
      missingLayerError(LAYER_RLB).message
    )
    expect(result.errors.map((e) => e.message)).toContain(
      missingLayerError(LAYER_HABITATS).message
    )
  })

  it('returns an error only for the missing layer when one is present', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: [LAYER_RLB]
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toBe(
      missingLayerError(LAYER_HABITATS).message
    )
  })
})

describe('format gate when a feature layer is not in gpkg-template.schema.json', () => {
  it('reports an unexpected layer error', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        illegalFeatureLayers: ['GhostLayer']
      })
    )

    expect(result.valid).toBe(false)
    expect(
      result.errors.some(
        (e) =>
          e.message.includes('GhostLayer') &&
          e.message.includes('not listed in baseline template schema')
      )
    ).toBe(true)
  })
})

describe('format gate when the Red Line Boundary geometry column is missing or invalid', () => {
  it('returns a descriptive error when there is no registered geometry column', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        rlbGeomColumnName: null
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toBe(
      'Red Line Boundary layer has no registered geometry column in gpkg_geometry_columns'
    )
  })

  it('returns GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME when Red Line Boundary column name is not a safe SQLite identifier', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        rlbGeomColumnName: 'geom"; DROP TABLE "Red Line Boundary"; --'
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe(
      'GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME'
    )
    expect(result.errors[0].message).toContain(
      'invalid name in gpkg_geometry_columns'
    )
  })

  it('returns structured invalid (not a throw) when gpkg_geometry_columns names a safe column absent from the RLB table', () => {
    const buffer = mutateSerializedBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      }),
      (db) => {
        db.prepare(
          `UPDATE gpkg_geometry_columns
              SET column_name = 'wrong_geom'
            WHERE table_name = ?`
        ).run(LAYER_RLB)
      }
    )
    const result = gateBuffer(buffer)

    expect(result.valid).toBe(false)
    expect(
      result.errors.some((e) => e.code === 'GPKG_BASELINE_MISSING_COLUMN')
    ).toBe(true)
    expect(
      result.errors.some((e) => String(e.message).includes('wrong_geom'))
    ).toBe(true)
  })

  it('accepts Red Line Boundary when the geometry column is named geom', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        rlbGeomColumnName: 'geom'
      })
    )

    expect(result.valid).toBe(true)
    expect(
      result.errors.some(
        (e) =>
          e.code === 'GPKG_BASELINE_MISSING_COLUMN' &&
          String(e.message).includes('"geometry"')
      )
    ).toBe(false)
  })
})

describe('format gate when a feature layer has multiple geometry columns in the table', () => {
  it('returns GPKG_BASELINE_MULTIPLE_GEOMETRY_COLUMNS', () => {
    const buffer = mutateSerializedBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      }),
      (db) => {
        db.exec(`ALTER TABLE "${LAYER_HABITATS}" ADD COLUMN geom2 MULTIPOLYGON`)
      }
    )
    const result = gateBuffer(buffer)

    expect(result.valid).toBe(false)
    expect(
      result.errors.some(
        (e) =>
          e.code === ERROR_CODES.GPKG_BASELINE_MULTIPLE_GEOMETRY_COLUMNS &&
          String(e.message).includes('feature table')
      )
    ).toBe(true)
  })
})

describe('format gate when the Red Line Boundary layer has an incorrect polygon count', () => {
  it('returns an error when there are no polygon features', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: { [LAYER_RLB]: [] }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toBe(ERR_ZERO_RLB.message)
  })

  it('returns an error when the only features are non-polygon geometries', () => {
    const result = gateBuffer(
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
    expect(result.errors[0].message).toBe(ERR_ZERO_RLB.message)
  })

  it('returns an error when there are multiple polygon features', () => {
    const result = gateBuffer(
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
    expect(result.errors[0].message).toBe(
      'Too many red line boundaries in GeoPackage (expecting one)'
    )
  })

  it('does not count non-polygon rows towards the polygon total', () => {
    const result = gateBuffer(
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

describe('format gate when the Red Line Boundary layer contains unreadable geometry', () => {
  it('returns an error when any geometry blob is unreadable', () => {
    const result = gateBuffer(
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
    expect(result.errors[0].message).toBe(ERR_UNREADABLE_RLB.message)
  })

  it('does not also report a polygon count error when geometry is unreadable', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [makeCorruptBlob()]
        }
      })
    )

    expect(result.errors.map((e) => e.message)).not.toContain(
      ERR_ZERO_RLB.message
    )
    expect(result.errors.map((e) => e.message)).toContain(
      ERR_UNREADABLE_RLB.message
    )
  })

  it('treats a blob with an out-of-range envelope indicator as unreadable', () => {
    const result = gateBuffer(
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
    expect(result.errors.map((e) => e.message)).toContain(
      ERR_UNREADABLE_RLB.message
    )
  })

  it('treats a blob too short for its declared envelope as unreadable', () => {
    const result = gateBuffer(
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
    expect(result.errors.map((e) => e.message)).toContain(
      ERR_UNREADABLE_RLB.message
    )
  })
})

describe('format gate when the GeoPackage is fully valid', () => {
  it('returns valid with no errors for a GP10 (v1.0) GeoPackage', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('returns valid with no errors for a GPKG (v1.2.1+) GeoPackage', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GPKG_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('matches layer names case-insensitively', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ['RED LINE BOUNDARY', 'HABITATS']
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('accepts a GeoPackage last saved in WAL journal mode', () => {
    // A GeoPackage checkpointed and closed in WAL mode has SQLite file-format
    // read version 2 in its header, which used to need a disk-staging fallback
    // because sqlite3_deserialize cannot service it. Now that the upload is
    // opened where it lies on disk (BMD-913) it is just another file.
    const result = gateBuffer(
      buildWalModeBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })
})
