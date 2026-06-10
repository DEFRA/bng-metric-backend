// The single sanctioned path for writing the bng.projects.project JSONB column.
//
// Every write validates the fragment it touches against the matching slice of
// the Joi schema (src/validation/project.js) BEFORE it reaches the database, so
// the persisted document can never drift from the schema — and therefore from
// the generated data dictionary.
//
// Partial updates use jsonb_set so we never re-serialise the whole document
// (a single habitat edit must not rewrite a baseline that can hold ~1000
// parcels). Each helper validates only the subtree it writes.
//
// A schema failure here means the SERVER assembled an invalid fragment — a bug,
// not bad client input (routes validate inbound payloads at the Hapi layer and
// return 400 before we get here). It surfaces as a 500 so it is caught and
// logged rather than silently written.
//
// Direct `.insert(projects)` / `.update(projects)` outside this module is banned
// by a no-restricted-syntax ESLint rule, so every new route that persists
// project data must come through here.
import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'

import { projects } from './schema/index.js'
import {
  projectSchema,
  baselineSchema,
  baselineUnitsTotalsSchema,
  habitatSchema,
  linearHabitatSchema,
  watercourseHabitatSchema
} from '../validation/project.js'

const FEATURE_SCHEMA_BY_LAYER = {
  habitats: habitatSchema,
  hedgerows: linearHabitatSchema,
  watercourses: watercourseHabitatSchema
}

function assertFragmentValid(schema, value, label) {
  const { error } = schema.validate(value)
  if (error) {
    throw Boom.badImplementation(
      `${label} failed schema validation before persist: ${error.message}`
    )
  }
}

/**
 * Build a `jsonb_set(target, path, value)` expression. `target` may be the
 * column or another jsonb_set expression (so calls compose for multi-path
 * writes). The path is bound as a parameter and cast to text[]; the value is a
 * bound jsonb parameter — neither is string-interpolated into SQL.
 */
function jsonbSet(target, path, value) {
  const pathLiteral = `{${path.join(',')}}`
  return sql`jsonb_set(${target}, ${pathLiteral}::text[], ${JSON.stringify(value)}::jsonb, true)`
}

/**
 * Insert a new project document (POST /projects/new). Validates the whole
 * document against projectSchema. Returns the inserted row.
 */
async function insertProject(db, { project, userId }) {
  assertFragmentValid(projectSchema, project, 'project')
  const [row] = await db
    .insert(projects)
    .values({ project, userId })
    .returning()
  return row
}

/**
 * Patch project.name only (PATCH /projects/{id}). Returns the updated row, or
 * null when no project matches the id.
 */
async function setProjectName(exec, id, name) {
  assertFragmentValid(projectSchema.extract('name'), name, 'project.name')
  const [row] = await exec
    .update(projects)
    .set({ project: jsonbSet(projects.project, ['name'], name) })
    .where(eq(projects.id, id))
    .returning()
  return row ?? null
}

/**
 * Replace project.baseline only (baseline upload persist). Validates the
 * baseline subtree against baselineSchema.
 */
async function setProjectBaseline(exec, id, baseline) {
  assertFragmentValid(baselineSchema, baseline, 'project.baseline')
  await exec
    .update(projects)
    .set({ project: jsonbSet(projects.project, ['baseline'], baseline) })
    .where(eq(projects.id, id))
}

/**
 * Patch a single baseline feature and the refreshed unit totals — two small
 * jsonb_set writes instead of rewriting the whole features array. The feature
 * is validated against its layer's item schema and the totals against
 * baselineUnitsTotalsSchema.
 *
 * @param {object} exec drizzle handle or transaction
 * @param {string} id project id
 * @param {object} params
 * @param {'habitats'|'hedgerows'|'watercourses'} params.layer
 * @param {number} params.index position of the feature within its layer array
 * @param {object} params.feature the updated feature document
 * @param {object} params.unitsTotals refreshed baseline.units totals
 */
async function setBaselineFeature(
  exec,
  id,
  { layer, index, feature, unitsTotals }
) {
  const featureSchema = FEATURE_SCHEMA_BY_LAYER[layer]
  if (!featureSchema) {
    throw Boom.badImplementation(`persist: unknown baseline layer "${layer}"`)
  }
  assertFragmentValid(featureSchema, feature, `baseline.${layer}[${index}]`)
  assertFragmentValid(baselineUnitsTotalsSchema, unitsTotals, 'baseline.units')

  const withFeature = jsonbSet(
    projects.project,
    ['baseline', layer, index],
    feature
  )
  const withTotals = jsonbSet(withFeature, ['baseline', 'units'], unitsTotals)
  await exec
    .update(projects)
    .set({ project: withTotals })
    .where(eq(projects.id, id))
}

export { insertProject, setProjectName, setProjectBaseline, setBaselineFeature }
