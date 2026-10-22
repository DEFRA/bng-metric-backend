import Database from 'better-sqlite3'
import { TEMPLATE_SCHEMA, versionRecordText } from 'bng-library/bng-service'

import { ERROR_CODES } from '../errors.js'
import { validateServiceTemplateGpkgFile } from './service-template-gate.js'
import { buildServiceTemplateBuffer } from '../../../../test/helpers/service-template-gpkg.js'
import {
  fullReadBuffer,
  mutateSerializedBuffer,
  withTempGpkgFile
} from '../../../../test/helpers/gpkg.js'

const AREA_BASELINE = 'Area Habitats Baseline'
const RED_LINE_BOUNDARY = 'Red Line Boundary'

/** Run the gate over a file built from `options`. */
function gate(options) {
  return withTempGpkgFile(buildServiceTemplateBuffer(options), (filePath) =>
    validateServiceTemplateGpkgFile(filePath)
  )
}

const codes = (result) => result.errors.map((error) => error.code)

describe('validateServiceTemplateGpkgFile', () => {
  test('passes a BNG Service template file and names its template and version', async () => {
    const result = await gate()

    expect(result).toEqual({
      valid: true,
      errors: [],
      template: { name: 'bng-service', version: '1.0' }
    })
  })

  describe('the version record', () => {
    test('refuses a file with none', async () => {
      const result = await gate({ records: [] })

      expect(result.valid).toBe(false)
      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_MISSING])
      expect(result.template).toBeNull()
    })

    test('does not count a metadata row from another standard', async () => {
      const result = await gate({ standardUri: 'http://mrcc.com/qgis.dtd' })

      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_MISSING])
    })

    test('refuses a file with two, saying how many', async () => {
      const result = await gate({
        records: [versionRecordText(), versionRecordText()]
      })

      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_DUPLICATED])
      expect(result.errors[0].message).toContain('2 template version records')
    })

    test('refuses a version the service does not read, naming it', async () => {
      const result = await gate({ records: [versionRecordText('2.0')] })

      expect(result.errors).toEqual([
        {
          code: ERROR_CODES.TEMPLATE_VERSION_UNSUPPORTED,
          message: expect.stringContaining('version 2.0'),
          details: { version: '2.0' }
        }
      ])
    })

    test.each([
      ['is not JSON', { records: ['format=bng-service;version=1.0'] }],
      ['is JSON but not an object', { records: ['"1.0"'] }],
      [
        'names another format',
        { records: [versionRecordText('1.0', 'legacy')] }
      ],
      ['names no version', { records: ['{"format": "bng-service"}'] }],
      [
        'names a blank version',
        { records: ['{"format": "bng-service", "version": " "}'] }
      ],
      ['is referenced to one table, not the file', { recordScope: 'table' }],
      ['is not referenced to anything', { recordScope: null }]
    ])('refuses a record that %s', async (_, options) => {
      const result = await gate(options)

      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_INVALID])
    })

    test('reads a record stored as a BLOB', async () => {
      const buffer = mutateSerializedBuffer(
        buildServiceTemplateBuffer(),
        (db) =>
          db.exec('UPDATE gpkg_metadata SET metadata = CAST(metadata AS BLOB)')
      )

      const result = await withTempGpkgFile(buffer, (filePath) =>
        validateServiceTemplateGpkgFile(filePath)
      )

      expect(result.valid).toBe(true)
      expect(result.template).toEqual({ name: 'bng-service', version: '1.0' })
    })

    test('refuses a file without the metadata extension as having none', async () => {
      const buffer = mutateSerializedBuffer(
        buildServiceTemplateBuffer(),
        (db) =>
          db.exec(
            'DROP TABLE gpkg_metadata_reference; DROP TABLE gpkg_metadata'
          )
      )

      const result = await withTempGpkgFile(buffer, (filePath) =>
        validateServiceTemplateGpkgFile(filePath)
      )

      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_MISSING])
    })

    test('refuses a record when the file has no metadata references at all', async () => {
      const buffer = mutateSerializedBuffer(
        buildServiceTemplateBuffer(),
        (db) => db.exec('DROP TABLE gpkg_metadata_reference')
      )

      const result = await withTempGpkgFile(buffer, (filePath) =>
        validateServiceTemplateGpkgFile(filePath)
      )

      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_INVALID])
    })

    test('is read before the tables, so a file without one reports only that', async () => {
      const result = await gate({ records: [], omitTables: [AREA_BASELINE] })

      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_MISSING])
    })
  })

  describe('a legacy file', () => {
    test('is refused as legacy, pointing at the QGIS plugin', async () => {
      const result = await withTempGpkgFile(fullReadBuffer(), (filePath) =>
        validateServiceTemplateGpkgFile(filePath)
      )

      expect(codes(result)).toEqual([ERROR_CODES.LEGACY_TEMPLATE_NOT_ACCEPTED])
      expect(result.errors[0].message).toMatch(/BNG Service template/)
      expect(result.errors[0].message).toMatch(/QGIS plugin/)
    })
  })

  describe('the tables, columns and geometry', () => {
    test.each(TEMPLATE_SCHEMA.tables.map((table) => table.name))(
      'refuses a file without the %s table',
      async (table) => {
        const result = await gate({ omitTables: [table] })

        expect(result.errors).toEqual([
          {
            code: ERROR_CODES.GPKG_MISSING_LAYER,
            message: `Missing required feature layer in GeoPackage: ${table}`
          }
        ])
      }
    )

    test('refuses a missing column, naming the table and the column', async () => {
      const result = await gate({
        dropColumns: { [AREA_BASELINE]: ['Baseline Condition'] }
      })

      expect(result.errors).toEqual([
        {
          code: ERROR_CODES.GPKG_BASELINE_MISSING_COLUMN,
          message: `Layer "${AREA_BASELINE}" does not match the BNG Service template: missing column "Baseline Condition"`
        }
      ])
    })

    test('refuses a renamed column as missing', async () => {
      const result = await gate({
        renameColumns: { [AREA_BASELINE]: { 'Habitat Ref': 'Parcel Ref' } }
      })

      expect(codes(result)).toEqual([ERROR_CODES.GPKG_BASELINE_MISSING_COLUMN])
    })

    test('refuses a column of the wrong type', async () => {
      const result = await gate({
        columnTypes: { [AREA_BASELINE]: { Area: 'TEXT' } }
      })

      expect(codes(result)).toEqual([
        ERROR_CODES.GPKG_BASELINE_COLUMN_SQLITE_TYPE
      ])
    })

    test.each([
      [AREA_BASELINE, 'MULTIPOLYGON'],
      ['Hedgerows Baseline', 'POLYGON'],
      ['Watercourses Post-Intervention', 'MULTILINESTRING'],
      ['Individual Trees Baseline', 'MULTIPOINT'],
      [RED_LINE_BOUNDARY, 'POINT']
    ])(
      'refuses %s with %s geometry, as the template has single-part geometry',
      async (table, geometryType) => {
        const result = await gate({ geometryTypes: { [table]: geometryType } })

        expect(codes(result)).toContain(
          ERROR_CODES.GPKG_BASELINE_GEOMETRY_TYPE_NAME
        )
        expect(result.errors[0].message).toContain(`"${table}"`)
      }
    )

    test('refuses a table in another spatial reference system', async () => {
      const result = await gate({ srsIds: { [RED_LINE_BOUNDARY]: 4326 } })

      expect(codes(result)).toEqual([ERROR_CODES.GPKG_BASELINE_SRS_ID])
    })

    test('refuses a geometry column the template names differently', async () => {
      const result = await gate({
        geometryColumnNames: { [RED_LINE_BOUNDARY]: 'geometry' }
      })

      expect(result.errors).toEqual([
        {
          code: ERROR_CODES.GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME,
          message: `Layer "${RED_LINE_BOUNDARY}" does not match the BNG Service template: its geometry column is named "geometry" but should be "geom"`
        }
      ])
    })

    test('refuses a Red Line Boundary with no geometry column', async () => {
      const result = await gate({ unregisteredGeometry: [RED_LINE_BOUNDARY] })

      expect(codes(result)).toEqual([ERROR_CODES.GPKG_RLB_NO_GEOMETRY_COLUMN])
    })

    test('refuses another habitat table with no geometry column', async () => {
      const result = await gate({ unregisteredGeometry: [AREA_BASELINE] })

      expect(codes(result)).toEqual([
        ERROR_CODES.GPKG_BASELINE_GEOMETRY_REGISTRATION_MISSING
      ])
    })

    test('refuses a feature table the template does not have', async () => {
      const result = await gate({ extraFeatureTables: ['Ponds'] })

      expect(result.errors).toEqual([
        {
          code: ERROR_CODES.GPKG_UNEXPECTED_FEATURE_LAYER,
          message:
            'Unexpected feature layer "Ponds" — not a table of the BNG Service template'
        }
      ])
    })

    test('reports every problem in the file, in the template’s terms', async () => {
      const result = await gate({
        dropColumns: { [AREA_BASELINE]: ['Area'] },
        geometryTypes: { 'Hedgerows Post-Intervention': 'POLYGON' },
        srsIds: { [RED_LINE_BOUNDARY]: 4326 }
      })

      expect(result.errors.length).toBeGreaterThanOrEqual(3)
      for (const error of result.errors) {
        expect(error.message).not.toMatch(/baseline mismatch/)
      }
    })

    test('still names the template and version of a file it refuses', async () => {
      const result = await gate({ omitTables: [AREA_BASELINE] })

      expect(result.template).toEqual({ name: 'bng-service', version: '1.0' })
    })
  })

  describe('a file that is not a GeoPackage', () => {
    test('refuses one that is not SQLite', async () => {
      const result = await withTempGpkgFile(
        Buffer.from('not a database'),
        (filePath) => validateServiceTemplateGpkgFile(filePath)
      )

      expect(codes(result)).toEqual([ERROR_CODES.GPKG_INVALID_FILE])
    })

    test('refuses SQLite that is not a GeoPackage', async () => {
      const db = new Database(':memory:')
      const buffer = Buffer.from(db.serialize())
      db.close()

      const result = await withTempGpkgFile(buffer, (filePath) =>
        validateServiceTemplateGpkgFile(filePath)
      )

      expect(codes(result)).toEqual([ERROR_CODES.GPKG_NOT_A_GEOPACKAGE])
    })
  })
})
