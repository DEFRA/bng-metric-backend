/**
 * Template-to-service field mapping generator (BMD-1178).
 *
 * Emits data-dictionary/template-mapping.md and
 * data-dictionary/template-mapping.json: for every column of every table of
 * the BNG Service template, at each stage, the stored field it fills (as its
 * path in the data dictionary), whether the service uses it, ignores it or
 * refuses the file on it, and what uses it.
 *
 * Its sources are declarative: the template's GeoPackage specification
 * (bng-library's copy of bng-metric-template's spec/gpkg-spec.json, so every
 * column the specification lists, fid and geometry included, must be
 * mapped), the reader's column mapping (template-mapping.js), the uses
 * beside it (template-column-uses.js), the PostGIS table each layer's
 * geometry is stored in (src/db/feature-tables.js) and the data dictionary's
 * fields (the Joi project schema and the Drizzle tables). It reads no clock and no randomness, so it writes the same
 * bytes from the same code, and CI diffs it as it diffs the data dictionary.
 * It refuses to write a mapping with a column unaccounted for.
 *
 * Run: npm run data-dictionary (which runs it after the data dictionary)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GPKG_SPEC,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION
} from 'bng-library/bng-service'

import { FEATURE_TABLE_SETS } from '../src/db/feature-tables.js'
import { TEMPLATE_COLUMN_USES_1_0 } from '../src/validation/geopackage/service-template/template-column-uses.js'
import {
  BOTH_STAGES,
  buildTemplateFieldMapping
} from '../src/validation/geopackage/service-template/template-field-mapping.js'
import { TEMPLATE_MAPPING_1_0 } from '../src/validation/geopackage/service-template/template-mapping.js'
import {
  collectProjectFields,
  collectTables,
  describeTable
} from './gen-data-dictionary.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DICTIONARY_DIR = join(HERE, '..', 'data-dictionary')

const TEMPLATE_NAME = 'bng-service'
const TEMPLATE_VERSION = '1.0'

// Fixed, not derived from `git remote`, so the output is the same everywhere.
const REPO_URL = 'https://github.com/DEFRA/bng-metric-backend'
const REPO_BRANCH = 'main'

function repoFileLink(relPath, label = relPath) {
  return `[\`${label}\`](${REPO_URL}/blob/${REPO_BRANCH}/${relPath})`
}

const MAPPING_REF =
  'src/validation/geopackage/service-template/template-mapping.js'
const USES_REF =
  'src/validation/geopackage/service-template/template-column-uses.js'
const DATA_DICTIONARY_REF = 'data-dictionary/data-dictionary.md'
const SPEC_URL =
  'https://github.com/DEFRA/bng-metric-template/blob/main/spec/gpkg-spec.md'

const STAGE_LABELS = {
  [STAGE_BASELINE]: 'baseline',
  [STAGE_POST_INTERVENTION]: 'post-intervention',
  [BOTH_STAGES]: 'both stages'
}

/**
 * Each document → each of its layers → the PostGIS column its geometry is
 * stored in, as its path in the data dictionary (`bng.baseline_habitats.geom`).
 */
function geometryColumns() {
  return Object.fromEntries(
    Object.entries(FEATURE_TABLE_SETS).map(([document, tables]) => [
      document,
      Object.fromEntries(
        Object.entries(tables).map(([layer, table]) => [
          layer,
          `${describeTable(table).name}.${table.geom.name}`
        ])
      )
    ])
  )
}

/** Every path the data dictionary declares: project fields and table columns. */
function dictionaryPaths() {
  const tableColumns = collectTables().flatMap(({ name, columns }) =>
    columns.map((column) => `${name}.${column.name}`)
  )
  return new Set([
    ...collectProjectFields().map(({ path }) => path),
    ...tableColumns
  ])
}

/** What the mapping is built from. */
export function templateMappingSources() {
  return {
    spec: GPKG_SPEC,
    mapping: TEMPLATE_MAPPING_1_0,
    uses: TEMPLATE_COLUMN_USES_1_0,
    geometryColumns: geometryColumns(),
    dictionaryPaths: dictionaryPaths()
  }
}

/**
 * The mapping's rows, or a thrown error naming every column unaccounted for.
 *
 * @returns {import('../src/validation/geopackage/service-template/template-field-mapping.js').MappingRow[]}
 */
export function generateTemplateMapping() {
  const { rows, problems } = buildTemplateFieldMapping(templateMappingSources())
  if (problems.length > 0) {
    const listed = problems.map((problem) => `  - ${problem}`).join('\n')
    throw new Error(`The template mapping is incomplete:\n${listed}`)
  }
  return rows
}

function escapeCell(value) {
  return String(value)
    .replaceAll('|', String.raw`\|`)
    .replaceAll('\n', ' ')
}

const code = (value) => `\`${value}\``

function renderRow(row) {
  const stored =
    row.storedFields.length > 0 ? row.storedFields.map(code).join(', ') : '—'
  const usedBy = row.usedBy.length > 0 ? row.usedBy.join(', ') : '—'
  return `| ${escapeCell(row.column)} | ${row.use} | ${usedBy} | ${escapeCell(stored)} | ${escapeCell(row.note) || '—'} |`
}

function renderTable(table, stage, rows) {
  return [
    `### ${table}`,
    '',
    `Stage: ${STAGE_LABELS[stage]}.`,
    '',
    '| Column | Use | Used by | Stored field | Note |',
    '| ------ | --- | ------- | ------------ | ---- |',
    ...rows.map(renderRow),
    ''
  ].join('\n')
}

function renderTables(rows) {
  const byTable = new Map()
  for (const row of rows) {
    byTable.set(row.table, [...(byTable.get(row.table) ?? []), row])
  }
  return [...byTable].map(([table, tableRows]) =>
    renderTable(table, tableRows[0].stage, tableRows)
  )
}

function countOf(rows, use) {
  return rows.filter((row) => row.use === use).length
}

export function renderMarkdown(rows) {
  return [
    '# BNG Service template: field mapping',
    '',
    `> Generated by \`npm run data-dictionary\` (${repoFileLink(
      'scripts/gen-template-mapping.js'
    )}).`,
    `> Do not edit by hand: change the reader's column mapping (${repoFileLink(MAPPING_REF)})`,
    `> or the column uses beside it (${repoFileLink(USES_REF)}) and regenerate.`,
    '',
    `How the service consumes each column of version ${TEMPLATE_VERSION} of the BNG Service`,
    'template, on each table and stage: the field it is stored in, as its path in the',
    `${repoFileLink(DATA_DICTIONARY_REF, 'data dictionary')}, whether the service uses it,`,
    'ignores it or refuses the file on it, and what uses it.',
    '',
    `The columns are those of the [GeoPackage specification](${SPEC_URL}), which`,
    'describes the template file itself; every column it lists has a row here.',
    '',
    `${rows.length} columns: ${countOf(rows, 'used')} used, ${countOf(rows, 'ignored')} ignored, ${countOf(rows, 'refused')} refused on.`,
    '',
    '## Reading the mapping',
    '',
    '- **Use**: `used`, the service reads the value; `ignored`, it does nothing with',
    '  it; `refused`, it reads the value only to refuse a file on it.',
    '- **Used by**: `calculation`, the biodiversity units; `validation`, a check that',
    '  refuses a file, or an edit, on the value; `display`, the stored value shown',
    '  back to the user.',
    '- **Stored field**: the paths in the data dictionary the value is saved to.',
    '  Every column the service reads is also kept, under its own name, in the',
    "  feature's `properties` open map; a column the reader drops is never",
    "  stored. The geometry is stored in the layer's PostGIS table instead, keyed",
    "  by the feature's `featureId`.",
    '- **Stages**: a baseline upload reads the Baseline tables. A baseline +',
    '  post-intervention upload reads every table, and saves the Baseline tables',
    '  as the baseline as it does so. Both read the Red Line Boundary, into each',
    "  stage's document.",
    '- Every text column, used or not, is checked at upload for its length and,',
    "  for a drop-down, that the template's list offers the value. That check is",
    '  not listed as a use.',
    '',
    '## Tables',
    '',
    ...renderTables(rows)
  ].join('\n')
}

export function renderJson(rows) {
  return {
    template: { name: TEMPLATE_NAME, version: TEMPLATE_VERSION },
    columns: rows
  }
}

if (import.meta.main) {
  console.log('Generating the template field mapping…')
  const rows = generateTemplateMapping()
  console.log(`  • ${rows.length} template columns`)

  mkdirSync(DATA_DICTIONARY_DIR, { recursive: true })
  const markdownPath = join(DATA_DICTIONARY_DIR, 'template-mapping.md')
  const jsonPath = join(DATA_DICTIONARY_DIR, 'template-mapping.json')

  writeFileSync(markdownPath, `${renderMarkdown(rows)}\n`)
  writeFileSync(jsonPath, `${JSON.stringify(renderJson(rows), null, 2)}\n`)

  console.log(`  • wrote ${markdownPath}`)
  console.log(`  • wrote ${jsonPath}`)
  console.log('Done.')
}
