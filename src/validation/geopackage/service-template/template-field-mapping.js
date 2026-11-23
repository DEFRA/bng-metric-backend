import {
  RED_LINE_BOUNDARY,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION
} from 'bng-library/bng-service'

import { USE } from './template-column-uses.js'

/**
 * The template-to-service field mapping (BMD-1178): for every column of every
 * template table, at each stage, the stored field it fills, whether the
 * service uses, ignores or refuses the file on it, and what uses it.
 *
 * Built from three declarative sources, so it cannot drift from the code:
 * the template's schema (bng-library's TEMPLATE_SCHEMA), the reader's column
 * mapping (template-mapping.js) and the column uses beside it
 * (template-column-uses.js). scripts/gen-template-mapping.js writes it to
 * data-dictionary/template-mapping.md and .json.
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

/** The fields a column fills at a stage, as full data-dictionary paths. */
function storedFields({ layer, stage, column, readAs, columnUse }) {
  if (stage === BOTH_STAGES) {
    return []
  }
  const feature = `${STAGE_DOCUMENT[stage]}.${DOCUMENT_LAYER[layer]}[]`
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
 * @property {string | null} readAs the name the reader reads it by, or null when it drops it
 * @property {string} use one of USE
 * @property {string[]} usedBy
 * @property {string[]} storedFields full paths in the data dictionary
 * @property {string} note
 */

/**
 * The problems that stop the mapping being built: a table or column the
 * reader does not map, a column with no use, a use for a column the template
 * lacks, a dropped column not ignored, or a stored field the data dictionary
 * does not declare. Each names its table and column.
 *
 * @param {{ schema: { tables: Array<{ name: string, columns: Array<{ name: string }> }> }, mapping: object, uses: object, dictionaryPaths: Set<string> }} sources
 * @returns {{ rows: MappingRow[], problems: string[] }}
 */
export function buildTemplateFieldMapping({
  schema,
  mapping,
  uses,
  dictionaryPaths
}) {
  const tables = tablesRead(mapping)
  const rows = []
  const problems = []
  const covered = new Map()

  for (const { name: table, columns } of schema.tables) {
    const read = tables.get(table)
    if (!read) {
      problems.push(`${table}: the reader maps no layer to this table`)
      continue
    }
    const { layer, stage } = read
    const layerColumns = new Set(covered.get(layer))
    for (const { name: column } of columns) {
      layerColumns.add(column)
      const readAs = mapping[layer].columns.get(column)
      const columnUse = uses[layer]?.[column]
      if (readAs === undefined) {
        problems.push(`${table} / ${column}: no mapping in the reader`)
        continue
      }
      if (!columnUse) {
        problems.push(`${table} / ${column}: no use in template-column-uses.js`)
        continue
      }
      if (readAs === null && columnUse.use !== USE.IGNORED) {
        problems.push(
          `${table} / ${column}: the reader drops it, so it must be ignored, not ${columnUse.use}`
        )
      }
      const fields = storedFields({ layer, stage, column, readAs, columnUse })
      for (const field of fields) {
        if (!dictionaryPaths.has(dictionaryPathOf(field))) {
          problems.push(
            `${table} / ${column}: ${field} is not in the data dictionary`
          )
        }
      }
      rows.push({
        table,
        stage,
        column,
        readAs,
        use: columnUse.use,
        usedBy: [...columnUse.usedBy],
        storedFields: fields,
        note: columnUse.note
      })
    }
    covered.set(layer, layerColumns)
  }

  for (const [layer, columns] of Object.entries(uses)) {
    for (const column of Object.keys(columns)) {
      if (!covered.get(layer)?.has(column)) {
        problems.push(
          `${layer} / ${column}: a use for a column no ${layer} table has`
        )
      }
    }
  }

  return { rows, problems }
}
