/**
 * Data dictionary generator.
 *
 * Emits data-dictionary/data-dictionary.md and
 * data-dictionary/data-dictionary.json from the two declarative sources of truth
 * already in the repo — no database connection, no clock, no randomness, so the
 * output is deterministic and CI can diff it:
 *
 *   1. Postgres columns  ← Drizzle table definitions in src/db/schema/*
 *   2. The `project` JSONB document ← the Joi schema in src/validation/project.js
 *      (walked via projectSchema.describe()), including each field's
 *      .description() prose.
 *
 * Plain-language table summaries (TABLE_DESCRIPTIONS) and the GitHub repo URL
 * for source-file links also live here in the generator. Source references in
 * the Markdown are absolute GitHub links so they resolve in the Confluence page
 * mirrored from this file on merge to main, where repo-relative links break.
 *
 * The Joi schema is the *intended* shape of the JSONB blob. The companion
 * guard test (src/validation/project-coverage.test.js) proves the code only
 * persists declared fields, so this dictionary stays faithful to reality.
 *
 * Run: npm run data-dictionary
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTableName, is, SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core'

import * as dbSchema from '../src/db/schema/index.js'
import { projectSchema } from '../src/validation/project.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DICTIONARY_DIR = join(HERE, '..', 'data-dictionary')
const TEMPLATE_REF =
  'src/validation/baseline/reference/baseline-template.schema.json'
const PROP_KEYS_REF = 'src/validation/baseline/properties.js'

// Source-file references in the Markdown link to the canonical copy on GitHub so
// they resolve wherever the dictionary is read — in particular the Confluence
// page mirrored from it on merge to main, where repo-relative links would break.
// The repo URL is a fixed constant (not derived from `git remote`) so the
// generated output stays byte-identical across environments and the CI freshness
// diff stays reliable.
const REPO_URL = 'https://github.com/DEFRA/bng-metric-backend'
const REPO_BRANCH = 'main'

function repoFileLink(relPath, label = relPath) {
  return `[\`${label}\`](${REPO_URL}/blob/${REPO_BRANCH}/${relPath})`
}

const dialect = new PgDialect()

// ─── Postgres column introspection ──────────────────────────────────────────

// Plain-language summary of each Postgres table for non-technical readers,
// surfaced beneath the table heading in the Markdown (and mirrored into the
// JSON). Keep each to a single short sentence; add an entry when a new table is
// introduced.
const TABLE_DESCRIPTIONS = {
  'bng.projects':
    'One row per BNG project, holding the live project document plus its owner and version details.',
  'bng.audit_log':
    'A full snapshot of a project after every change, recording who made it and when, for audit history.',
  'bng.baseline_red_line':
    "The single red-line boundary outlining the overall extent of a project's development site.",
  'bng.baseline_habitats':
    'The mapped outline of each baseline area-habitat parcel imported from the uploaded GeoPackage.',
  'bng.baseline_hedgerows':
    'The mapped line of each baseline hedgerow imported from the uploaded GeoPackage.',
  'bng.baseline_watercourses':
    'The mapped line of each baseline watercourse imported from the uploaded GeoPackage.',
  'bng.baseline_trees':
    'The mapped point of each baseline individual tree imported from the uploaded GeoPackage.',
  'bng.post_intervention_red_line':
    'The single red-line boundary outlining the extent of the post-intervention (proposed) site.',
  'bng.post_intervention_habitats':
    'The mapped outline of each post-intervention (proposed) area-habitat parcel imported from the uploaded GeoPackage.',
  'bng.post_intervention_hedgerows':
    'The mapped line of each post-intervention (proposed) hedgerow imported from the uploaded GeoPackage.',
  'bng.post_intervention_watercourses':
    'The mapped line of each post-intervention (proposed) watercourse imported from the uploaded GeoPackage.',
  'bng.post_intervention_trees':
    'The mapped point of each post-intervention (proposed) individual tree imported from the uploaded GeoPackage.',
  'bng.users':
    'One row per authenticated Defra ID user, upserted from the verified token on each login (identity and last sign-in).',
  'bng.relationships':
    "The organisations a user is related to, taken from their Defra ID token and upserted on each login (one row per user's relationship).",
  'bng.roles':
    'The roles and their approval status a user holds per organisation relationship, upserted from the Defra ID token on each login; drives project access control.'
}

function formatDefault(column) {
  if (!column.hasDefault) {
    return null
  }
  const value = column.default
  if (value === undefined) {
    return '(generated)'
  }
  if (is(value, SQL)) {
    try {
      return dialect.sqlToQuery(value).sql
    } catch {
      return '(sql expression)'
    }
  }
  return String(value)
}

function describeTable(table) {
  const config = getTableConfig(table)

  const fkByColumn = new Map()
  for (const foreignKey of config.foreignKeys) {
    const reference = foreignKey.reference()
    const targetTable = getTableName(reference.foreignTable)
    reference.columns.forEach((column, index) => {
      const targetColumn = reference.foreignColumns[index]?.name
      fkByColumn.set(column.name, `${targetTable}.${targetColumn}`)
    })
  }

  const uniqueColumns = new Set()
  for (const unique of config.uniqueConstraints ?? []) {
    for (const column of unique.columns) {
      uniqueColumns.add(column.name)
    }
  }

  const columns = config.columns.map((column) => ({
    name: column.name,
    type: column.getSQLType(),
    nullable: !column.notNull,
    primaryKey: Boolean(column.primary),
    unique: Boolean(column.isUnique) || uniqueColumns.has(column.name),
    default: formatDefault(column),
    references: fkByColumn.get(column.name) ?? null
  }))

  const name = `${config.schema}.${config.name}`
  return { name, description: TABLE_DESCRIPTIONS[name] ?? null, columns }
}

function collectTables() {
  return Object.values(dbSchema)
    .filter((value) => is(value, PgTable))
    .map(describeTable)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Fail loudly (rather than emitting a blank cell) if a table has no entry in
// TABLE_DESCRIPTIONS, so a newly added table can't slip into the dictionary
// undocumented — the CI freshness check and pre-commit guard surface it.
function assertAllTablesDescribed(tables) {
  const undescribed = tables
    .filter((table) => !table.description)
    .map((table) => table.name)
  if (undescribed.length > 0) {
    throw new Error(
      `Missing TABLE_DESCRIPTIONS for ${undescribed.join(', ')} — add a one-sentence summary in scripts/gen-data-dictionary.js`
    )
  }
}

// ─── Joi schema walk ─────────────────────────────────────────────────────────

function formatRule(rule) {
  switch (rule.name) {
    case 'integer':
      return 'integer'
    case 'min':
      return `min ${rule.args.limit}`
    case 'max':
      return `max ${rule.args.limit}`
    case 'length':
      return `length ${rule.args.limit}`
    case 'guid':
      return 'uuid'
    case 'isoDate':
      return 'ISO 8601 date'
    case 'pattern':
      return `pattern ${rule.args?.regex ?? ''}`
    default:
      return rule.name
  }
}

function itemTypeLabel(node) {
  return node.type === 'object' ? 'object' : (node.type ?? 'any')
}

function typeLabel(node) {
  if (node.type === 'array') {
    const item = node.items?.[0]
    return `array<${item ? itemTypeLabel(item) : 'any'}>`
  }
  return node.type
}

function nodeMeta(node) {
  const allow = node.allow ?? []
  const isEnum = node.flags?.only === true
  return {
    type: typeLabel(node),
    required: node.flags?.presence === 'required',
    nullable: allow.includes(null),
    emptyStringAllowed: allow.includes(''),
    enumValues: isEnum ? allow.filter((v) => v !== null && v !== '') : [],
    constraints: (node.rules ?? []).map(formatRule),
    openMap:
      node.type === 'object' && node.flags?.unknown === true && !node.keys,
    description: node.flags?.description ?? ''
  }
}

function walkSchema(node, path, rows) {
  const meta = nodeMeta(node)
  if (path) {
    rows.push({ path, ...meta })
  }
  if (meta.openMap) {
    return
  }
  if (node.type === 'object' && node.keys) {
    for (const [key, child] of Object.entries(node.keys)) {
      walkSchema(child, path ? `${path}.${key}` : key, rows)
    }
  } else if (node.type === 'array' && node.items?.[0]) {
    walkSchema(node.items[0], `${path}[]`, rows)
  } else {
    // leaf node — no children to walk
  }
}

function collectProjectFields() {
  const rows = []
  walkSchema(projectSchema.describe(), '', rows)
  return rows
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

function escapeCell(value) {
  return String(value)
    .replaceAll('|', String.raw`\|`)
    .replaceAll('\n', ' ')
}

const tick = (value) => (value ? '✓' : '—')

function renderConstraints(field) {
  const parts = []
  if (field.enumValues.length > 0) {
    parts.push(`one of: ${field.enumValues.join(', ')}`)
  }
  if (field.emptyStringAllowed) {
    parts.push('`""` allowed')
  }
  for (const constraint of field.constraints) {
    parts.push(`\`${constraint}\``)
  }
  if (field.openMap) {
    parts.push('open map (arbitrary keys)')
  }
  return parts.join('; ') || '—'
}

function columnKeyLabel(column) {
  const keyParts = []
  if (column.primaryKey) {
    keyParts.push('PK')
  }
  if (column.references) {
    keyParts.push(`FK → \`${column.references}\``)
  }
  if (column.unique && !column.primaryKey) {
    keyParts.push('UNIQUE')
  }
  return keyParts.join(', ') || '—'
}

function defaultLabel(value) {
  return value ? `\`${escapeCell(value)}\`` : '—'
}

function renderColumnRow(column) {
  return `| \`${column.name}\` | \`${column.type}\` | ${tick(
    column.nullable
  )} | ${columnKeyLabel(column)} | ${defaultLabel(column.default)} |`
}

function renderPostgresSection(tables) {
  const lines = ['## Postgres tables', '']
  for (const table of tables) {
    lines.push(`### \`${table.name}\``, '')
    if (table.description) {
      lines.push(table.description, '')
    }
    lines.push(
      '| Column | Type | Nullable | Key | Default |',
      '| --- | --- | --- | --- | --- |',
      ...table.columns.map(renderColumnRow),
      ''
    )
  }
  return lines.join('\n')
}

function renderProjectJsonSection(fields) {
  const lines = [
    '## The `project` JSONB document',
    '',
    'Stored in `bng.projects.project` and snapshotted verbatim into',
    '`bng.audit_log.project`. Fields below are derived from the Joi schema in',
    `${repoFileLink('src/validation/project.js')}.`,
    '',
    '| Field | Type | Constraints | Description |',
    '| --- | --- | --- | --- |'
  ]
  for (const field of fields) {
    lines.push(
      `| \`${field.path}\` | \`${field.type}\` | ${renderConstraints(
        field
      )} | ${escapeCell(field.description) || '—'} |`
    )
  }
  return lines.join('\n')
}

function renderNotesSection() {
  return [
    '## Notes',
    '',
    '- **`*.properties` open maps** hold the raw attribute columns copied',
    `  verbatim from the uploaded GeoPackage. Their column catalogue is defined`,
    `  separately in ${repoFileLink(TEMPLATE_REF)}; the case-insensitive`,
    `  key resolution lives in ${repoFileLink(PROP_KEYS_REF)}.`,
    '- **Derived unit fields** (`distinctiveness`, `distinctivenessScore`,',
    '  `conditionScore`, `units`) are set on habitats, hedgerows and watercourses',
    '  by bng-metric-engine — during baseline import enrichment and again when a',
    '  feature is edited. `units` is the single field read by the frontend display',
    '  and the baseline unit totals. Watercourses additionally carry',
    '  `waterEncroachmentMultiplier` / `riparianEncroachmentMultiplier`.',
    '- **Enum values** for habitat type, broad type, condition, distinctiveness',
    '  etc. are not enumerated in the Joi schema; they are resolved at runtime',
    '  from `bng-metric-engine` via `src/validation/baseline/reference/*`.',
    ''
  ].join('\n')
}

function renderMarkdown(tables, fields) {
  return [
    '# Data dictionary',
    '',
    `> Generated by \`npm run data-dictionary\` (${repoFileLink(
      'scripts/gen-data-dictionary.js'
    )}).`,
    '> Do not edit by hand — change the Drizzle schema or the Joi `.description()`',
    `> annotations and regenerate. See ${repoFileLink('docs/DATA_DICTIONARY.md')} for`,
    '> the workflow and the CI freshness check.',
    '',
    renderPostgresSection(tables),
    renderProjectJsonSection(fields),
    '',
    renderNotesSection()
  ].join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('Generating data dictionary…')
const allTables = collectTables()
assertAllTablesDescribed(allTables)
const allFields = collectProjectFields()
console.log(
  `  • ${allTables.length} Postgres tables, ${allFields.length} project JSON fields`
)

mkdirSync(DATA_DICTIONARY_DIR, { recursive: true })

const markdownPath = join(DATA_DICTIONARY_DIR, 'data-dictionary.md')
const jsonPath = join(DATA_DICTIONARY_DIR, 'data-dictionary.json')

writeFileSync(markdownPath, `${renderMarkdown(allTables, allFields)}\n`)
writeFileSync(
  jsonPath,
  `${JSON.stringify({ postgres: allTables, projectJson: allFields }, null, 2)}\n`
)

console.log(`  • wrote ${markdownPath}`)
console.log(`  • wrote ${jsonPath}`)
console.log('Done.')
