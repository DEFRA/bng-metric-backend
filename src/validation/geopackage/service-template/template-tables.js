import { FORMAT_BNG_SERVICE } from 'bng-library/bng-service'

import { templateForVersion } from './supported-versions.js'

/**
 * Where a read finds the BNG Service template's layers, in place of the legacy
 * template's table aliases.
 *
 * The format gate has already identified the file and checked it against its
 * version, so the tables are named, not searched for: each logical layer the
 * version's mapping reads comes from that layer's table at the requested stage.
 */

/** The primary key, kept on every feature: messages name a row by it. */
const FID = 'fid'

/**
 * @typedef {object} TemplateReadSource
 * @property {string} format always bng-library's FORMAT_BNG_SERVICE
 * @property {string} version a template version the service reads
 * @property {string} stage bng-library's STAGE_BASELINE or STAGE_POST_INTERVENTION
 *
 * A plain object, so it can be posted to a GEOS worker as it is.
 */

/**
 * @param {string} version
 * @param {string} stage
 * @returns {TemplateReadSource}
 */
export function templateReadSource(version, stage) {
  return { format: FORMAT_BNG_SERVICE, version, stage }
}

/**
 * The logical layers a template read fills, the table each comes from, and
 * how each table's columns are carried.
 *
 * @param {string[]} tableNames the file's feature tables
 * @param {TemplateReadSource} source
 * @returns {{
 *   logicalTables: Map<string, string>,
 *   missingLayers: string[],
 *   columnMaps: Map<string, Map<string, string | null>>
 * }} `columnMaps` is keyed by lower-cased table name
 */
export function resolveTemplateTables(tableNames, source) {
  const template = templateForVersion(source.version)
  if (source.format !== FORMAT_BNG_SERVICE || !template) {
    throw new Error(
      `Cannot read a ${source.format} file in template version ${source.version}`
    )
  }

  const byLowerName = new Map(tableNames.map((t) => [t.toLowerCase(), t]))
  const logicalTables = new Map()
  const missingLayers = []
  const columnMaps = new Map()

  for (const [logical, layer] of Object.entries(template.mapping)) {
    const tableName = byLowerName.get(layer.table(source.stage).toLowerCase())
    if (tableName) {
      logicalTables.set(logical, tableName)
      columnMaps.set(tableName.toLowerCase(), layer.columns)
    } else {
      missingLayers.push(logical)
    }
  }

  return { logicalTables, missingLayers, columnMaps }
}

/**
 * A template row's attributes under the names the pipeline reads them by.
 * Columns the mapping does not read are left out; the primary key is kept.
 *
 * @param {object} row
 * @param {string} geometryColumn
 * @param {Map<string, string | null>} columns
 * @returns {object}
 */
export function templateFeatureProperties(row, geometryColumn, columns) {
  const properties = {}
  for (const [column, value] of Object.entries(row)) {
    if (column === FID) {
      properties[FID] = value
      continue
    }
    const name = column === geometryColumn ? null : columns.get(column)
    if (name) {
      properties[name] = value
    }
  }
  return properties
}
