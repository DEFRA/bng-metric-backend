import { FORMAT_BNG_SERVICE, RED_LINE_BOUNDARY } from 'bng-library/bng-service'

import { ERROR_CODES, makeError } from '../errors.js'
import {
  checkGeoPackageIdentity,
  checkRequiredLayersFromSchema,
  getFeatureLayerNames,
  legacyTemplateSchema,
  withGpkgFileDatabase
} from '../geopackage.js'
import { compareGpkgToBaselineSchema } from '../geopackage-internals-schema-compare.js'
import { createLogger } from '../../../common/helpers/logging/logger.js'
import { missingVersionError, readTemplateVersion } from './version-record.js'
import {
  supportedTemplateVersions,
  templateForVersion
} from './supported-versions.js'

const logger = createLogger()

/**
 * The format gate for the BNG Service template, used when the service-template
 * flag is on. It answers whether a file is a BNG Service template file in a
 * version the service reads, with the tables, columns and geometry types that
 * version has — without reading a single feature.
 *
 * The legacy gate (geopackage.js) is untouched and still serves the flag-off
 * path. The two share the comparison of a file against a schema; what differs
 * is the schema, and that this gate reads the version record first.
 */

/**
 * The legacy template's required tables that the BNG Service template does not
 * have. A file holding one of them, with no version record, is a legacy file.
 */
const LEGACY_ONLY_TABLES = legacyTemplateSchema.layers
  .filter((layer) => layer.required)
  .map((layer) => layer.tableName.toLowerCase())
  .filter((table) => table !== RED_LINE_BOUNDARY.toLowerCase())

const LEGACY_TEMPLATE_MESSAGE =
  'This file is in the legacy Natural England template. The service now takes the BNG Service template: convert the file with the QGIS plugin, then upload it again.'

/**
 * The shared comparison was written for the legacy template, which it calls the
 * "baseline" template. That word means a stage in this one, so its messages
 * are put in this template's terms. The codes are unchanged.
 */
const TEMPLATE_WORDING = [
  [' baseline mismatch:', ' does not match the BNG Service template:'],
  [
    ' — not listed in baseline template schema',
    ' — not a table of the BNG Service template'
  ]
]

function inTemplateTerms(error) {
  let message = error.message
  for (const [legacy, template] of TEMPLATE_WORDING) {
    message = message.replaceAll(legacy, template)
  }
  return { ...error, message }
}

function isLegacyTemplate(db) {
  const tables = getFeatureLayerNames(db)
  return LEGACY_ONLY_TABLES.some((table) => tables.has(table))
}

function versionErrors(db, record) {
  if (record.error) {
    return [record.error]
  }
  if (record.missing) {
    return [
      isLegacyTemplate(db)
        ? makeError(
            ERROR_CODES.LEGACY_TEMPLATE_NOT_ACCEPTED,
            LEGACY_TEMPLATE_MESSAGE
          )
        : missingVersionError()
    ]
  }
  return []
}

function unsupportedVersionError(version) {
  return makeError(
    ERROR_CODES.TEMPLATE_VERSION_UNSUPPORTED,
    `The file is in version ${version} of the BNG Service template, which the service does not read. It reads version ${supportedTemplateVersions().join(', ')}.`,
    { version }
  )
}

/**
 * The shared comparison leaves a Red Line Boundary with no registered geometry
 * column to the legacy gate's feature checks, which this gate does not run. So
 * it is reported here, under the code the legacy gate gives it.
 */
function checkRedLineBoundaryGeometry(db, errors) {
  const registered = db
    .prepare('SELECT 1 FROM gpkg_geometry_columns WHERE lower(table_name) = ?')
    .get(RED_LINE_BOUNDARY.toLowerCase())
  if (!registered) {
    errors.push(
      makeError(
        ERROR_CODES.GPKG_RLB_NO_GEOMETRY_COLUMN,
        `The ${RED_LINE_BOUNDARY} table has no geometry column`
      )
    )
  }
}

/**
 * The shared comparison does not check what a geometry column is called: the
 * legacy files in use name theirs either way. This template names every one
 * the same, so a table whose single geometry column is called something else
 * has been edited away from it.
 */
function checkGeometryColumnNames(db, schema, tables, errors) {
  const registrations = db.prepare(
    'SELECT column_name FROM gpkg_geometry_columns WHERE lower(table_name) = ?'
  )
  for (const layerDef of schema.layers) {
    const table = layerDef.tableName.toLowerCase()
    const rows = tables.has(table) ? registrations.all(table) : []
    const expected = layerDef.geometryColumn.name
    if (rows.length === 1 && rows[0].column_name !== expected) {
      errors.push(
        makeError(
          ERROR_CODES.GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME,
          `Layer "${layerDef.tableName}" does not match the BNG Service template: its geometry column is named "${rows[0].column_name}" but should be "${expected}"`
        )
      )
    }
  }
}

function checkStructure(db, schema) {
  const errors = []
  const tables = getFeatureLayerNames(db)
  checkRequiredLayersFromSchema(schema, tables, errors)
  compareGpkgToBaselineSchema(db, schema, errors)
  checkGeometryColumnNames(db, schema, tables, errors)
  if (tables.has(RED_LINE_BOUNDARY.toLowerCase())) {
    checkRedLineBoundaryGeometry(db, errors)
  }
  return errors.map(inTemplateTerms)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string, details?: object }>, template: { name: string, version: string } | null }}
 */
function runServiceTemplateGate(db) {
  const refused = (errors) => ({ valid: false, errors, template: null })

  const identityErrors = checkGeoPackageIdentity(db)
  if (identityErrors.length > 0) {
    return refused(identityErrors)
  }

  const record = readTemplateVersion(db)
  const recordErrors = versionErrors(db, record)
  if (recordErrors.length > 0) {
    return refused(recordErrors)
  }

  const template = templateForVersion(record.version)
  if (!template) {
    return refused([unsupportedVersionError(record.version)])
  }

  const structureErrors = checkStructure(db, template.schema)
  return {
    valid: structureErrors.length === 0,
    errors: structureErrors,
    template: { name: FORMAT_BNG_SERVICE, version: record.version }
  }
}

/**
 * Validate a downloaded file as a BNG Service template GeoPackage: the version
 * record first, then the tables, columns, geometry types and spatial reference
 * of that version. Nothing is unpacked.
 *
 * @param {string} filePath
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string, details?: object }>, template: { name: string, version: string } | null }}
 *   `template` names the template and version the file was checked against,
 *   once its version record has been read and is supported
 */
export function validateServiceTemplateGpkgFile(filePath) {
  const result = withGpkgFileDatabase(filePath, runServiceTemplateGate)
  logger.info(
    `validateServiceTemplateGpkg: valid=${result.valid}, errors=${JSON.stringify(result.errors)}`
  )
  return { template: null, ...result }
}
