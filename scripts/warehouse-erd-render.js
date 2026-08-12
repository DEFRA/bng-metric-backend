// Renders the warehouse model (warehouse-erd.js) as the markdown page shared
// with the external PowerBI / Synapse team: a Mermaid ER diagram, the key
// derivation rules, the guarantees those keys carry, and the per-table column
// mapping.
//
// Split from the model module so neither file does two jobs — the model decides
// *what* the tables are, this decides how they read.
//
// Pure: the driver (gen-warehouse-erd.js) writes the file.

const REPO_URL = 'https://github.com/DEFRA/bng-metric-backend'
const REPO_BRANCH = 'main'

function repoFileLink(relPath, label = relPath) {
  return `[\`${label}\`](${REPO_URL}/blob/${REPO_BRANCH}/${relPath})`
}

/**
 * Mermaid attribute comments are double-quoted and cannot themselves contain
 * quotes. Backticks are stripped too — markdown formatting does not apply
 * inside a diagram, so they would render as literal noise.
 */
function mermaidComment(note) {
  return note ? ` "${note.replaceAll('"', "'").replaceAll('`', '')}"` : ''
}

function mermaidAttribute(column) {
  const key = column.key ? ` ${column.key}` : ''
  return `        ${column.type} ${column.name}${key}${mermaidComment(column.note)}`
}

/**
 * The diagram shows keys plus a handful of identifying columns — the full
 * column list is the mapping section's job. A 361-field ERD is unreadable.
 */
function diagramColumns(table) {
  const highlight = new Set(table.highlight ?? [])
  return table.columns.filter(
    (column) =>
      column.key || column.name === 'document_key' || highlight.has(column.name)
  )
}

function mermaidEntity(table) {
  const attributes = diagramColumns(table).map(mermaidAttribute)
  return [`    ${table.table} {`, ...attributes, '    }'].join('\n')
}

function mermaidRelationship(table) {
  const cardinality = table.many ? '||--o{' : '||--o|'
  const verb = table.many ? 'contains' : 'has'
  return `    ${table.parent.table} ${cardinality} ${table.table} : "${verb}"`
}

function renderMermaid(tables) {
  const relationships = tables
    .filter((table) => table.parent)
    .map(mermaidRelationship)
  const entities = tables.map(mermaidEntity)
  return [
    '```mermaid',
    'erDiagram',
    ...relationships,
    '',
    ...entities,
    '```'
  ].join('\n')
}

function columnRow(column) {
  const key = column.key ?? ''
  const jsonPaths = column.jsonPaths.length
    ? column.jsonPaths.map((path) => `\`${path}\``).join('<br>')
    : '—'
  const note = column.note ?? ''
  return `| \`${column.name}\` | \`${column.type}\` | ${key} | ${jsonPaths} | ${note} |`
}

function renderTableSection(table) {
  const jsonColumns = table.columns.filter(
    (column) => column.jsonPaths.length > 0
  ).length
  return [
    `### \`${table.table}\``,
    '',
    `${table.description} ${jsonColumns} column(s) mapped from the JSON document.`,
    '',
    '| Column | Type | Key | JSON path | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...table.columns.map(columnRow),
    ''
  ].join('\n')
}

function renderKeySection(tables) {
  const rows = tables.map(
    (table) =>
      `| \`${table.table}\` | \`${table.primaryKey.column}\` | ${table.primaryKey.derivation} |`
  )
  return [
    '## Key derivation',
    '',
    'Only two kinds of key exist in this contract.',
    '',
    "**Stored UUIDs.** `projectId` is `bng.projects.id`, the row's existing",
    'Postgres primary key. `featureId` is the UUID stamped onto each feature at',
    'import, which is also the primary key of the matching PostGIS geometry row',
    '(`bng.baseline_habitats.id` and friends). Both are stable — see',
    '"Stability guarantees" below.',
    '',
    '**Derived keys.** Every other object in the document is exactly one per',
    'parent, so it needs no surrogate of its own: its key is composed from the',
    'ids above. Nothing is stored for these; compose them on read.',
    '',
    '| Table | Primary key | Derivation |',
    '| --- | --- | --- |',
    ...rows,
    ''
  ].join('\n')
}

function renderStabilitySection() {
  return [
    '## Stability guarantees',
    '',
    '- **`projectId` never changes.** It is the Postgres primary key, assigned',
    '  at creation.',
    '- **`featureId` survives edits.** Editing a habitat, hedgerow or watercourse',
    '  patches the feature in place; the id is untouched.',
    '- **`featureId` survives a re-upload where the `ref` is unchanged.** When a',
    '  user uploads a corrected GeoPackage over a document they already',
    '  imported, ids are carried forward by matching `ref` within each layer, so',
    '  a corrected file produces `UPDATE`s rather than a mass delete-and-insert.',
    `  See ${repoFileLink('src/validation/geopackage/carry-forward-feature-ids.js')}.`,
    '- **A `featureId` is regenerated** when the feature is new, when its `ref`',
    '  is blank, or when its `ref` is ambiguous (carried by more than one',
    '  feature on either side). Matching is deliberately conservative: `ref`',
    '  uniqueness is only *enforced* on the habitats layer, so the other layers',
    '  can legitimately arrive with repeats.',
    '',
    '`ref` is therefore the natural key worth surfacing in any report — it is',
    'what a surveyor recognises, and it is what the id follows.',
    ''
  ].join('\n')
}

function renderUpdateSection() {
  return [
    '## Update semantics',
    '',
    '- The payload is a **full snapshot**. Within a given',
    '  `(project_id, document_key)` scope it is authoritative: rows absent from',
    '  the payload have been deleted.',
    '- **`updated_at`** (`bng.projects.updated_at`, maintained by a BEFORE UPDATE',
    '  trigger) is the row watermark. Use it to order deliveries and discard',
    '  stale ones.',
    '- **`bng_project_version` is not a revision counter.** It is a static `1`,',
    '  never incremented by the application. Do not use it for concurrency',
    '  control.',
    '- Re-uploading a GeoPackage replaces the whole `baseline` or',
    '  `postIntervention` subtree, so treat an import as a full refresh of that',
    '  document scope — not a partial merge.',
    ''
  ].join('\n')
}

function renderModellingNotes() {
  return [
    '## Modelling notes',
    '',
    '- **Baseline and post-intervention features are separate tables**, not one',
    '  table with a discriminator. Post-intervention features carry nested',
    '  `baseline` / `proposed` blocks that baseline features do not, so a union',
    '  would be mostly null. Those nested blocks are flattened into the parent',
    '  row with `baseline_` / `proposed_` column prefixes — they are strictly one',
    '  per feature and need no key of their own.',
    '- **`feature_set`, `feature_set_units` and `feature_set_habitat_sizes` are',
    '  shared** between the two documents and discriminated by `document_key`.',
    '  Their column sets are identical across both, so a union is exact.',
    '- **The five `habitatSizes` sub-groups are flattened** into one row rather',
    '  than spawning five near-empty tables.',
    '- **`properties` stays a single `jsonb` column.** These are the verbatim',
    '  GeoPackage attribute columns; their keys are arbitrary and vary by source',
    '  file, so normalising them is not useful.',
    '- Feature rows join 1:1 to our PostGIS geometry tables on `feature_id`, so',
    '  geometry can be added later without re-keying anything.',
    ''
  ].join('\n')
}

/**
 * @param {{tables: object[], leafCount: number}} model
 * @returns {string}
 */
export function renderErdMarkdown(model) {
  const { tables } = model
  return [
    '# Warehouse ERD — the project document as relational tables',
    '',
    `> Generated by \`npm run data-dictionary\` (${repoFileLink(
      'scripts/gen-warehouse-erd.js'
    )}).`,
    '> Do not edit by hand — change the Joi schema in',
    `> ${repoFileLink('src/validation/project.js')} or the table layout in`,
    `> ${repoFileLink('scripts/warehouse-erd.js')} and regenerate.`,
    '',
    'We send the whole BNG project document as JSON; the receiving system maps',
    'it into relational rows and upserts them. This page is the contract for',
    'that mapping: the tables the document decomposes into, the key for each,',
    'and what those keys guarantee.',
    '',
    `Column-level detail — descriptions, constraints, nullability — lives in the ${repoFileLink(
      'data-dictionary/data-dictionary.md',
      'data dictionary'
    )}. This page covers structure and identity.`,
    '',
    `**${tables.length} tables**, mapping ${model.leafCount} schema fields.`,
    '',
    '## Diagram',
    '',
    renderMermaid(tables),
    '',
    renderKeySection(tables),
    renderStabilitySection(),
    renderUpdateSection(),
    renderModellingNotes(),
    '## Tables',
    '',
    ...tables.map(renderTableSection)
  ].join('\n')
}
