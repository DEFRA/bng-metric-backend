import { TEMPLATE_SCHEMA } from 'bng-library/bng-service'

import { GPKG_CONTENTS_FEATURES_DATA_TYPE } from '../geopackage-constants.js'
import { TEMPLATE_MAPPING_1_0 } from './template-mapping.js'

/**
 * The BNG Service template versions the service reads, and how to read each.
 *
 * Choosing by version, rather than by the flag, is what lets a later template
 * version be supported by adding an entry here — with its own schema and
 * column mapping — without changing the flag or the endpoints.
 * A version not listed is refused, naming the version found.
 */

const PRIMARY_KEY_COLUMN = 'fid'
const PRIMARY_KEY_TYPE = 'INTEGER'

/**
 * One template table, in the layer shape the structural comparison reads
 * (that of reference/gpkg-template.schema.json). Every table is required: a
 * baseline-stage file keeps its Post-Intervention tables, empty.
 *
 * @param {{ name: string, geometryColumn: string, geometryType: string, srsId: number, columns: Array<{ name: string, type: string }> }} table
 */
function toLayerDef(table) {
  return {
    tableName: table.name,
    required: true,
    dataType: GPKG_CONTENTS_FEATURES_DATA_TYPE,
    srsId: table.srsId,
    geometryColumn: {
      name: table.geometryColumn,
      geometryType: table.geometryType
    },
    columns: [
      {
        name: PRIMARY_KEY_COLUMN,
        sqliteType: PRIMARY_KEY_TYPE,
        notNull: true,
        primaryKey: true
      },
      {
        name: table.geometryColumn,
        sqliteType: table.geometryType,
        notNull: false,
        primaryKey: false
      },
      ...table.columns.map((column) => ({
        name: column.name,
        sqliteType: column.type,
        notNull: false,
        primaryKey: false
      }))
    ]
  }
}

/**
 * The structural schema for a template, from bng-library's copy of it.
 *
 * @param {{ tables: object[] }} templateSchema
 * @returns {{ layers: object[] }}
 */
export function toStructuralSchema(templateSchema) {
  return { layers: templateSchema.tables.map(toLayerDef) }
}

/**
 * bng-library holds one copy of the template, for the version it records as
 * current. A library that moves to a new version must come with a decision
 * here, which the test on this map forces.
 */
const SUPPORTED_TEMPLATE_VERSIONS = new Map([
  [
    '1.0',
    Object.freeze({
      schema: toStructuralSchema(TEMPLATE_SCHEMA),
      mapping: TEMPLATE_MAPPING_1_0
    })
  ]
])

/** The template versions the service reads, for messages and tests. */
export function supportedTemplateVersions() {
  return [...SUPPORTED_TEMPLATE_VERSIONS.keys()]
}

/**
 * How to read a template version, or null when the service does not read it.
 *
 * @param {string} version
 * @returns {{ schema: { layers: object[] }, mapping: Record<string, import('./template-mapping.js').LayerMapping> } | null}
 */
export function templateForVersion(version) {
  return SUPPORTED_TEMPLATE_VERSIONS.get(version) ?? null
}
