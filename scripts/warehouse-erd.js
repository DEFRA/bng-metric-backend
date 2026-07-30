// Derives the relational view of the project JSONB document — the shape the
// external PowerBI / Synapse warehouse maps our payload into.
//
// Pure module: the driver (gen-warehouse-erd.js) supplies the schema and writes
// the file, so every function here is unit-testable.
//
// Source of truth is projectSchema.describe(), the same input the data
// dictionary walks. The table layout below is the only hand-authored part; the
// columns and their types are derived, so a field added to the Joi schema shows
// up in the contract automatically — or fails the build if it lands somewhere
// the layout does not account for (see assignPathToTable).

const DOCUMENT_KEYS = Object.freeze(['baseline', 'postIntervention'])

/**
 * Columns that exist on the warehouse side but not in the JSONB document —
 * they come from the bng.projects row envelope or are the derived keys that
 * make the relational shape navigable.
 */
const PROJECT_ENVELOPE_COLUMNS = Object.freeze([
  { name: 'user_id', type: 'text', note: 'bng.projects.user_id' },
  { name: 'org_id', type: 'text', note: 'bng.projects.org_id' },
  {
    name: 'relationship_id',
    type: 'text',
    note: 'bng.projects.relationship_id'
  },
  { name: 'created_at', type: 'timestamptz', note: 'bng.projects.created_at' },
  {
    name: 'updated_at',
    type: 'timestamptz',
    note: 'bng.projects.updated_at — the row watermark for ordering deliveries'
  }
])

/**
 * The warehouse table layout.
 *
 * `sources` are JSON path prefixes; every declared leaf path is assigned to the
 * table whose longest source prefix it starts under. Two document keys sharing
 * one source list (feature_set and friends) means the two subtrees land in one
 * table discriminated by `document_key`.
 */
const TABLES = Object.freeze([
  {
    table: 'project',
    sources: [''],
    primaryKey: {
      column: 'project_id',
      type: 'uuid',
      derivation: 'bng.projects.id — the existing Postgres UUID, reused as-is'
    },
    envelope: PROJECT_ENVELOPE_COLUMNS,
    highlight: ['name'],
    description: 'One row per BNG project.'
  },
  {
    table: 'project_site',
    sources: ['site'],
    primaryKey: {
      column: 'site_id',
      type: 'text',
      derivation: '`{projectId}:site`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    highlight: ['name', 'grid_ref'],
    description: 'Development site details. Exactly one per project.'
  },
  {
    table: 'project_units',
    sources: ['units'],
    primaryKey: {
      column: 'units_id',
      type: 'text',
      derivation: '`{projectId}:units`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    highlight: ['habitat', 'hedgerow', 'watercourse'],
    description:
      'Project-level biodiversity unit summary. Exactly one per project.'
  },
  {
    table: 'project_details',
    sources: ['details'],
    primaryKey: {
      column: 'details_id',
      type: 'text',
      derivation: '`{projectId}:details`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    highlight: ['local_planning_authority', 'development_type'],
    description:
      'Project details entered by the user. Exactly one per project; null until the user fills them in.'
  },
  {
    table: 'feature_set',
    sources: DOCUMENT_KEYS,
    primaryKey: {
      column: 'feature_set_id',
      type: 'text',
      derivation: '`{projectId}:{documentKey}`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    // Up to two per project: one per document key.
    many: true,
    discriminator: {
      name: 'document_key',
      type: 'text',
      note: "'baseline' or 'postIntervention' — which subtree the row came from"
    },
    highlight: ['upload_id', 'filename', 'imported_at'],
    description:
      'One row per imported document per project: the GeoPackage upload that produced it.'
  },
  {
    table: 'feature_set_units',
    sources: DOCUMENT_KEYS.map((key) => `${key}.units`),
    primaryKey: {
      column: 'feature_set_units_id',
      type: 'text',
      derivation: '`{projectId}:{documentKey}:units`'
    },
    parent: { table: 'feature_set', column: 'feature_set_id', type: 'text' },
    highlight: ['total_units', 'habitats_total'],
    description:
      'Biodiversity unit totals for one document, summed across its features.'
  },
  {
    table: 'feature_set_habitat_sizes',
    sources: DOCUMENT_KEYS.map((key) => `${key}.habitatSizes`),
    primaryKey: {
      column: 'habitat_sizes_id',
      type: 'text',
      derivation: '`{projectId}:{documentKey}:habitatSizes`'
    },
    parent: { table: 'feature_set', column: 'feature_set_id', type: 'text' },
    highlight: [
      'area_habitats_total_square_metres',
      'site_total_square_metres'
    ],
    description:
      'Total feature sizes by module, measured from geometry in PostGIS. The five sub-groups in the JSON are flattened into one row.'
  }
])

/**
 * The feature layers. Baseline and post-intervention get separate tables rather
 * than one discriminated table: post-intervention features carry nested
 * `baseline` / `proposed` blocks that the baseline features do not, so a union
 * would be mostly nulls.
 */
const FEATURE_LAYERS = Object.freeze([
  { layer: 'redLine', suffix: 'red_line', singular: true },
  { layer: 'habitats', suffix: 'habitats', singular: false },
  { layer: 'trees', suffix: 'trees', singular: false },
  { layer: 'hedgerows', suffix: 'hedgerows', singular: false },
  { layer: 'watercourses', suffix: 'watercourses', singular: false }
])

const DOCUMENT_TABLE_PREFIX = Object.freeze({
  baseline: 'baseline',
  postIntervention: 'post_intervention'
})

const FEATURE_PRIMARY_KEY = Object.freeze({
  column: 'feature_id',
  type: 'uuid',
  derivation:
    "the feature's own `featureId` — also the PK of the matching PostGIS geometry row"
})

const FEATURE_HIGHLIGHT = Object.freeze(['ref', 'type', 'status', 'units'])
const RED_LINE_HIGHLIGHT = Object.freeze(['site_name', 'area'])

/**
 * Expand the ten feature tables from the layer × document-key grid.
 *
 * @returns {object[]}
 */
function featureTables() {
  const tables = []
  for (const documentKey of DOCUMENT_KEYS) {
    for (const { layer, suffix, singular } of FEATURE_LAYERS) {
      const source = singular
        ? `${documentKey}.${layer}`
        : `${documentKey}.${layer}[]`
      tables.push({
        table: `${DOCUMENT_TABLE_PREFIX[documentKey]}_${suffix}`,
        sources: [source],
        primaryKey: FEATURE_PRIMARY_KEY,
        parent: {
          table: 'feature_set',
          column: 'feature_set_id',
          type: 'text'
        },
        many: !singular,
        highlight: singular ? RED_LINE_HIGHLIGHT : FEATURE_HIGHLIGHT,
        description: singular
          ? `Red Line Boundary defining the site extent (${documentKey}). At most one per document.`
          : `${layer} in the ${documentKey} document.`
      })
    }
  }
  return tables
}

/** All tables, ordered as they should appear in the document. */
export function warehouseTables() {
  return [...TABLES, ...featureTables()]
}

// --- schema walk -----------------------------------------------------------

/**
 * True when a Joi node is an open map — `.unknown(true)` with no declared keys
 * (the verbatim `*.properties` GeoPackage blobs). These stay a single jsonb
 * column: their keys are arbitrary and vary by source file.
 */
function isOpenMap(node) {
  return node.type === 'object' && node.flags?.unknown === true && !node.keys
}

function hasRule(node, name) {
  return Boolean(node.rules?.some((rule) => rule.name === name))
}

function stringSqlType(node) {
  // Joi's .uuid() is an alias for .guid(); describe() reports the latter.
  if (hasRule(node, 'guid')) {
    return 'uuid'
  }
  if (hasRule(node, 'isoDate')) {
    return 'timestamptz'
  }
  return 'text'
}

/**
 * @param {object} node a Joi describe() node
 * @returns {string} the SQL type we advertise for the column
 */
function sqlType(node) {
  if (node.type === 'number') {
    return hasRule(node, 'integer') ? 'integer' : 'numeric'
  }
  if (node.type === 'string') {
    return stringSqlType(node)
  }
  if (node.type === 'object' || node.type === 'array') {
    return 'jsonb'
  }
  return 'text'
}

function childPath(basePath, key) {
  return basePath ? `${basePath}.${key}` : key
}

/**
 * Walk a Joi describe() tree into the flat list of leaf paths — the things that
 * become columns. Containers (objects with keys, arrays) are structure, not
 * data, so they are not emitted.
 *
 * @param {object} node
 * @param {string} path
 * @param {Array<{path: string, type: string, openMap: boolean}>} out
 */
export function schemaLeaves(node, path = '', out = []) {
  if (isOpenMap(node)) {
    out.push({ path, type: 'jsonb', openMap: true })
    return out
  }
  if (node.type === 'object' && node.keys) {
    for (const [key, child] of Object.entries(node.keys)) {
      schemaLeaves(child, childPath(path, key), out)
    }
    return out
  }
  const item = node.type === 'array' ? node.items?.[0] : undefined
  if (item) {
    schemaLeaves(item, `${path}[]`, out)
    return out
  }
  out.push({ path, type: sqlType(node), openMap: false })
  return out
}

// --- path → column mapping -------------------------------------------------

const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g

/**
 * `areaHabitats.totalSquareMetres` → `area_habitats_total_square_metres`
 *
 * @param {string} remainder path relative to the table's source prefix
 * @returns {string}
 */
export function toColumnName(remainder) {
  return remainder
    .replaceAll('[]', '')
    .replaceAll('.', '_')
    .replaceAll(CAMEL_BOUNDARY, '$1_$2')
    .toLowerCase()
}

/**
 * Source prefixes, longest first, so `baseline.habitats[]` claims a path before
 * the broader `baseline` prefix can.
 *
 * @returns {Array<{prefix: string, table: object}>}
 */
function sourcePrefixes(tables) {
  const prefixes = []
  for (const table of tables) {
    for (const prefix of table.sources) {
      prefixes.push({ prefix, table })
    }
  }
  return prefixes.sort((a, b) => b.prefix.length - a.prefix.length)
}

function matchesPrefix(path, prefix) {
  if (prefix === '') {
    // The root table claims top-level scalars only. A new nested structure must
    // be claimed by a table that names its subtree, so it fails the build
    // rather than silently flattening itself onto `project`.
    return !path.includes('.')
  }
  return path.startsWith(`${prefix}.`)
}

function remainderFor(path, prefix) {
  return prefix === '' ? path : path.slice(prefix.length + 1)
}

/**
 * Assign one leaf path to its table. Throws when nothing claims it — a new
 * field in projectSchema that the layout does not account for must fail the
 * build rather than silently vanish from a contract an external team relies on.
 *
 * @param {{path: string}} leaf
 * @param {Array<{prefix: string, table: object}>} prefixes
 */
function assignPathToTable(leaf, prefixes) {
  const hit = prefixes.find(({ prefix }) => matchesPrefix(leaf.path, prefix))
  if (!hit) {
    throw new Error(
      `warehouse-erd: no table claims the schema path "${leaf.path}". ` +
        "Add it to a table's `sources` in scripts/warehouse-erd.js."
    )
  }
  return hit
}

/**
 * @param {object} table
 * @returns {Array<object>} the non-JSON columns this table carries
 */
function syntheticColumns(table) {
  const columns = [
    {
      name: table.primaryKey.column,
      type: table.primaryKey.type,
      key: 'PK',
      note: table.primaryKey.derivation,
      jsonPaths: []
    }
  ]
  if (table.parent) {
    columns.push({
      name: table.parent.column,
      type: table.parent.type,
      key: 'FK',
      note: `→ ${table.parent.table}.${table.parent.column}`,
      jsonPaths: []
    })
  }
  if (table.discriminator) {
    columns.push({ ...table.discriminator, key: null, jsonPaths: [] })
  }
  for (const envelope of table.envelope ?? []) {
    columns.push({ ...envelope, key: null, jsonPaths: [] })
  }
  return columns
}

/**
 * Feature tables key on the JSON `featureId`, so that path is already covered
 * by the synthetic PK and must not also appear as an ordinary column.
 */
function isPrimaryKeyPath(table, columnName) {
  return columnName === 'feature_id' && table.primaryKey.column === 'feature_id'
}

/**
 * Build the full warehouse model: every table with its columns, in document
 * order, plus the JSON path each column came from.
 *
 * @param {object} describe output of projectSchema.describe()
 * @returns {{tables: object[], leafCount: number}}
 */
export function buildWarehouseModel(describe) {
  const tables = warehouseTables().map((table) => ({
    ...table,
    columns: syntheticColumns(table)
  }))
  const byName = new Map(tables.map((table) => [table.table, table]))
  const prefixes = sourcePrefixes(tables)
  const leaves = schemaLeaves(describe)

  for (const leaf of leaves) {
    const { prefix, table } = assignPathToTable(leaf, prefixes)
    const target = byName.get(table.table)
    const name = toColumnName(remainderFor(leaf.path, prefix))
    if (isPrimaryKeyPath(target, name)) {
      continue
    }
    // feature_set and friends are shared between the two document subtrees, so
    // the same column arrives twice. Record both source paths against the one
    // column rather than dropping the second — the contract has to name every
    // place a value can come from.
    const existing = target.columns.find((column) => column.name === name)
    if (existing) {
      existing.jsonPaths.push(leaf.path)
      continue
    }
    target.columns.push({
      name,
      type: leaf.type,
      key: null,
      note: leaf.openMap ? 'verbatim GeoPackage attribute columns' : null,
      jsonPaths: [leaf.path]
    })
  }

  return { tables, leafCount: leaves.length }
}

// --- rendering -------------------------------------------------------------

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
    '  See ' +
      repoFileLink('src/validation/baseline/carry-forward-feature-ids.js') +
      '.',
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
