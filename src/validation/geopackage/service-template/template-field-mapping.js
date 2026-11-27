import {
  RED_LINE_BOUNDARY,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION
} from 'bng-library/bng-service'

import { USE } from './template-column-uses.js'
import { PRIMARY_KEY, READ_AS_GEOMETRY } from './template-mapping.js'

/**
 * The template-to-service field mapping (BMD-1178): for every column of every
 * template table, at each stage, the stored field it fills, whether the
 * service uses, ignores or refuses the file on it, and what uses it.
 *
 * Built from declarative sources, so it cannot drift from the code: the
 * template's GeoPackage specification (bng-library's GPKG_SPEC, as
 * bng-metric-template publishes it: every column, fid and geometry
 * included), the reader's column mapping (template-mapping.js), the column
 * uses beside it (template-column-uses.js), and the PostGIS table each
 * layer's geometry is stored in. scripts/gen-template-mapping.js writes it
 * to data-dictionary/template-mapping.md and .json.
 */

/** The project document each stage's tables are saved to. */
const STAGE_DOCUMENT = Object.freeze({
  [STAGE_BASELINE]: 'baseline',
  [STAGE_POST_INTERVENTION]: 'postIntervention'
})

/** Each logical layer → the document key its features are stored under. */
const DOCUMENT_LAYER = Object.freeze({
  redline: 'redLine',
  areas: 'habitats',
  verticalHabitats: 'verticalHabitats',
  hedgerows: 'hedgerows',
  watercourses: 'watercourses',
  trees: 'trees'
})

/** The stage a Red Line Boundary row is given: one table serves both. */
export const BOTH_STAGES = 'both'

const STAGES = [STAGE_BASELINE, STAGE_POST_INTERVENTION]

/** The open map each feature keeps the columns the reader reads in. */
const PROPERTIES = 'properties'

/** The layer a document holds one feature of, not an array of them. */
const SINGLE_FEATURE_LAYER = 'redline'

/**
 * Each template table → the logical layer and stage the reader reads it as.
 *
 * @param {Record<string, import('./template-mapping.js').LayerMapping>} mapping
 * @returns {Map<string, { layer: string, stage: string }>}
 */
function tablesRead(mapping) {
  const tables = new Map()
  for (const [layer, { table }] of Object.entries(mapping)) {
    for (const stage of STAGES) {
      const name = table(stage)
      tables.set(name, {
        layer,
        stage: name === RED_LINE_BOUNDARY ? BOTH_STAGES : stage
      })
    }
  }
  return tables
}

/** The data-dictionary path of a layer's feature in a stage's document. */
function featurePath(stage, layer) {
  const many = layer === SINGLE_FEATURE_LAYER ? '' : '[]'
  return `${STAGE_DOCUMENT[stage]}.${DOCUMENT_LAYER[layer]}${many}`
}

/** The fields a column fills at one stage, as full data-dictionary paths. */
function stageFields({ layer, stage, column, readAs, columnUse, sources }) {
  // The geometry is stored in the layer's PostGIS table, keyed by the
  // feature's featureId, not in the document.
  if (readAs === READ_AS_GEOMETRY) {
    return [
      sources.geometryColumns[STAGE_DOCUMENT[stage]][DOCUMENT_LAYER[layer]]
    ]
  }
  const feature = featurePath(stage, layer)
  const named =
    columnUse[stage === STAGE_BASELINE ? 'baseline' : 'postIntervention']
  const fields = named.map((field) => `${feature}.${field}`)
  // A column the reader reads is kept, under the template's own name, in the
  // feature's `properties` (stored-properties.js).
  if (readAs !== null) {
    fields.push(`${feature}.${PROPERTIES}["${column}"]`)
  }
  return fields
}

/**
 * The fields a column fills, as full data-dictionary paths: at both stages
 * for the Red Line Boundary, whose one table each stage's document reads.
 */
function storedFields(column) {
  const stages = column.stage === BOTH_STAGES ? STAGES : [column.stage]
  return stages.flatMap((stage) => stageFields({ ...column, stage }))
}

/**
 * How the reader reads a column: by the name the mapping gives it, or null
 * when it drops it. The primary key and the geometry are read on every
 * table, beside the mapping (template-tables.js).
 *
 * @returns {string | null | undefined} undefined when the reader has no mapping for it
 */
function readAsOf(layerMapping, geometryColumn, column) {
  if (column === PRIMARY_KEY) {
    return PRIMARY_KEY
  }
  if (column === geometryColumn) {
    return READ_AS_GEOMETRY
  }
  return layerMapping.columns.get(column)
}

/** The data-dictionary path of a stored field: `properties["…"]` is the open map. */
export function dictionaryPathOf(field) {
  const bracket = field.indexOf('["')
  return bracket === -1 ? field : field.slice(0, bracket)
}

/**
 * @typedef {object} MappingRow
 * @property {string} table the template table
 * @property {string} stage STAGE_BASELINE, STAGE_POST_INTERVENTION or BOTH_STAGES
 * @property {string} column the template column
 * @property {string | null} readAs the name the reader reads it by, `geometry` for the feature's shape, or null when it drops it
 * @property {string} use one of USE
 * @property {string[]} usedBy
 * @property {string[]} storedFields full paths in the data dictionary
 * @property {string} note
 */

/**
 * Why a column cannot be mapped, or null when it can.
 *
 * @param {string | null | undefined} readAs
 * @param {object | undefined} columnUse
 * @returns {string | null}
 */
function unmappable(readAs, columnUse) {
  if (readAs === undefined) {
    return 'no mapping in the reader'
  }
  if (!columnUse) {
    return 'no use in template-column-uses.js'
  }
  return null
}

/**
 * One column's row, and the problems with it.
 *
 * @returns {{ row: MappingRow | null, problems: string[] }}
 */
function columnRow({ table, layer, stage, column, geometryColumn, sources }) {
  const label = `${table} / ${column}`
  const readAs = readAsOf(sources.mapping[layer], geometryColumn, column)
  const columnUse = sources.uses[layer]?.[column]
  const reason = unmappable(readAs, columnUse)
  if (reason) {
    return { row: null, problems: [`${label}: ${reason}`] }
  }
  const problems = []
  if (readAs === null && columnUse.use !== USE.IGNORED) {
    problems.push(
      `${label}: the reader drops it, so it must be ignored, not ${columnUse.use}`
    )
  }
  const fields = storedFields({
    layer,
    stage,
    column,
    readAs,
    columnUse,
    sources
  })
  const undeclared = fields.filter(
    (field) => !sources.dictionaryPaths.has(dictionaryPathOf(field))
  )
  problems.push(
    ...undeclared.map(
      (field) => `${label}: ${field} is not in the data dictionary`
    )
  )
  const row = {
    table,
    stage,
    column,
    readAs,
    use: columnUse.use,
    usedBy: [...columnUse.usedBy],
    storedFields: fields,
    note: columnUse.note
  }
  return { row, problems }
}

/**
 * One table's rows, and the problems with its columns.
 *
 * @returns {{ rows: MappingRow[], problems: string[] }}
 */
function tableRows({ table, columns, geometryColumn, layer, stage, sources }) {
  const found = columns.map(({ name: column }) =>
    columnRow({ table, layer, stage, column, geometryColumn, sources })
  )
  return {
    rows: found.map(({ row }) => row).filter(Boolean),
    problems: found.flatMap(({ problems }) => problems)
  }
}

/**
 * The uses that name a column none of their layer's tables has.
 *
 * @param {object} uses
 * @param {Map<string, Set<string>>} covered each layer → its tables' columns
 * @returns {string[]}
 */
function strayUses(uses, covered) {
  return Object.entries(uses).flatMap(([layer, columns]) =>
    Object.keys(columns)
      .filter((column) => !covered.get(layer)?.has(column))
      .map(
        (column) =>
          `${layer} / ${column}: a use for a column no ${layer} table has`
      )
  )
}

/**
 * The problems that stop the mapping being built: a table or column the
 * reader does not map, a column with no use, a use for a column the template
 * lacks, a dropped column not ignored, or a stored field the data dictionary
 * does not declare. Each names its table and column.
 *
 * @param {{ spec: { tables: Array<{ name: string, geometryColumn: string, columns: Array<{ name: string }> }> }, mapping: object, uses: object, geometryColumns: Record<string, Record<string, string>>, dictionaryPaths: Set<string> }} sources
 *   `geometryColumns`: each document → each of its layers → the PostGIS
 *   column its geometry is stored in, as its data-dictionary path
 * @returns {{ rows: MappingRow[], problems: string[] }}
 */
export function buildTemplateFieldMapping(sources) {
  const tables = tablesRead(sources.mapping)
  const rows = []
  const problems = []
  const covered = new Map()

  for (const { name: table, columns, geometryColumn } of sources.spec.tables) {
    const read = tables.get(table)
    if (read) {
      const found = tableRows({
        table,
        columns,
        geometryColumn,
        ...read,
        sources
      })
      rows.push(...found.rows)
      problems.push(...found.problems)
      const layerColumns = covered.get(read.layer) ?? new Set()
      columns.forEach(({ name }) => layerColumns.add(name))
      covered.set(read.layer, layerColumns)
    } else {
      problems.push(`${table}: the reader maps no layer to this table`)
    }
  }

  problems.push(...strayUses(sources.uses, covered))
  return { rows, problems }
}
