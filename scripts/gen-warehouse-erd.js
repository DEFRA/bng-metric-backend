// Writes docs/warehouse-erd.md — the relational view of the project document
// shared with the external PowerBI / Synapse team.
//
// Deterministic: no DB connection, no clock, no randomness, so `git diff` after
// a regenerate is a reliable freshness gate (see the data-dictionary:check
// script and the matching CI step).
//
// The model and rendering live in warehouse-erd.js so they can be unit-tested;
// this file only supplies the schema and writes the output.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildWarehouseModel, renderErdMarkdown } from './warehouse-erd.js'
import { projectSchema } from '../src/validation/project.js'

const DOCS_DIR = 'docs'

console.log('Generating warehouse ERD…')

const model = buildWarehouseModel(projectSchema.describe())
console.log(
  `  • ${model.tables.length} tables, ${model.leafCount} project JSON fields`
)

mkdirSync(DOCS_DIR, { recursive: true })

const markdownPath = join(DOCS_DIR, 'warehouse-erd.md')
writeFileSync(markdownPath, `${renderErdMarkdown(model)}\n`)

console.log(`  • wrote ${markdownPath}`)
console.log('Done.')
