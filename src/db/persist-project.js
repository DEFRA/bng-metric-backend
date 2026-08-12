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
  postInterventionDataSchema,
  postInterventionHabitatSchema,
  postInterventionLinearHabitatSchema,
  postInterventionWatercourseSchema
} from '../validation/post-intervention/project-post-intervention-schema.js'
import {
  projectSchema,
  projectDetailsSchema,
  habitatDataSchema,
  baselineUnitsTotalsSchema,
  habitatSchema,
  linearHabitatSchema,
  watercourseHabitatSchema
} from '../validation/project.js'

const HABITAT_DATA_SCHEMA_BY_DOCUMENT_KEY = {
  baseline: habitatDataSchema,
  postIntervention: postInterventionDataSchema
}

const FEATURE_SCHEMA_BY_LAYER = {
  habitats: habitatSchema,
  hedgerows: linearHabitatSchema,
  watercourses: watercourseHabitatSchema
}

const POST_INTERVENTION_FEATURE_SCHEMA_BY_LAYER = {
  habitats: postInterventionHabitatSchema,
  hedgerows: postInterventionLinearHabitatSchema,
  watercourses: postInterventionWatercourseSchema
}

function habitatDataSchemaFor(documentKey) {
  const schema = HABITAT_DATA_SCHEMA_BY_DOCUMENT_KEY[documentKey]
  if (!schema) {
    throw Boom.badImplementation(
      `persist: unknown habitat document key "${documentKey}"`
    )
  }
  return schema
}

function featureSchemaFor(documentKey, layer) {
  const schemas =
    documentKey === 'postIntervention'
      ? POST_INTERVENTION_FEATURE_SCHEMA_BY_LAYER
      : FEATURE_SCHEMA_BY_LAYER
  const featureSchema = schemas[layer]
  if (!featureSchema) {
    throw Boom.badImplementation(`persist: unknown feature layer "${layer}"`)
  }
  return featureSchema
}

function assertFragmentValid(schema, value, label) {
  const { error } = schema.validate(value)
  if (error) {
    throw Boom.badImplementation(
      `${label} failed schema validation before persist: ${error.message}`
    )
  }
}

function assertActorId(actorId) {
  if (typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw Boom.badImplementation(
      'persist: verified actor identity is required for every project write'
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
 * document against projectSchema. The org context (orgId/relationshipId) is
 * stamped from the creator's verified token by the route — they default to null
 * for callers/tests that don't supply them. Returns the inserted row.
 */
async function insertProject(
  db,
  { project, userId, orgId = null, relationshipId = null }
) {
  assertActorId(userId)
  assertFragmentValid(projectSchema, project, 'project')
  const [row] = await db
    .insert(projects)
    .values({ project, userId, lastModifiedBy: userId, orgId, relationshipId })
    .returning()
  return row
}

/**
 * Patch project.name only (PATCH /projects/{id}). Returns the updated row, or
 * null when no project matches `where`.
 *
 * `where` defaults to matching the id alone; routes pass a stricter condition
 * (id AND RBAC visibility) so a non-visible project updates nothing and the
 * route returns 404 — without leaking existence.
 */
async function setProjectName(
  exec,
  id,
  name,
  actorId,
  where = eq(projects.id, id)
) {
  assertActorId(actorId)
  assertFragmentValid(projectSchema.extract('name'), name, 'project.name')
  const [row] = await exec
    .update(projects)
    .set({
      project: jsonbSet(projects.project, ['name'], name),
      lastModifiedBy: actorId
    })
    .where(where)
    .returning()
  return row ?? null
}

/**
 * Replace one habitat document only. Used for post-intervention persistence;
 * baseline replacement has additional cleanup in setProjectBaseline.
 */
async function setProjectHabitatData(
  exec,
  id,
  habitatData,
  actorId,
  documentKey
) {
  assertActorId(actorId)
  assertFragmentValid(
    habitatDataSchemaFor(documentKey),
    habitatData,
    `project.${documentKey}`
  )
  await exec
    .update(projects)
    .set({
      project: jsonbSet(projects.project, [documentKey], habitatData),
      lastModifiedBy: actorId
    })
    .where(eq(projects.id, id))
}

/**
 * Replace the baseline and remove post-intervention data in one JSONB update.
 * This keeps the project document consistent with the geometry cleanup in the
 * surrounding upload transaction.
 */
async function setProjectBaseline(exec, id, baseline, actorId) {
  assertActorId(actorId)
  assertFragmentValid(habitatDataSchema, baseline, 'project.baseline')
  const withBaseline = jsonbSet(projects.project, ['baseline'], baseline)
  await exec
    .update(projects)
    .set({
      project: sql`${withBaseline} - 'postIntervention'`,
      lastModifiedBy: actorId
    })
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
async function setProjectFeature(
  exec,
  id,
  { documentKey = 'baseline', layer, index, feature, unitsTotals, actorId }
) {
  assertActorId(actorId)
  assertFragmentValid(
    featureSchemaFor(documentKey, layer),
    feature,
    `${documentKey}.${layer}[${index}]`
  )
  assertFragmentValid(
    baselineUnitsTotalsSchema,
    unitsTotals,
    `${documentKey}.units`
  )

  const withFeature = jsonbSet(
    projects.project,
    [documentKey, layer, index],
    feature
  )
  const withTotals = jsonbSet(withFeature, [documentKey, 'units'], unitsTotals)
  await exec
    .update(projects)
    .set({ project: withTotals, lastModifiedBy: actorId })
    .where(eq(projects.id, id))
}

async function setBaselineFeature(exec, id, params) {
  await setProjectFeature(exec, id, { ...params, documentKey: 'baseline' })
}

/**
 * Merge patch into project.details atomically (PATCH /projects/{id}/details).
 * Uses a single UPDATE with a COALESCE || jsonb expression so concurrent
 * writes cannot silently overwrite each other. Returns the updated row, or
 * null when no project matches `where`.
 *
 * `where` defaults to matching the id alone; routes pass a stricter condition
 * (id AND RBAC visibility) so a non-visible project updates nothing and the
 * route returns 404 — without leaking existence.
 */
async function setProjectDetails(
  exec,
  id,
  patch,
  actorId,
  where = eq(projects.id, id)
) {
  assertActorId(actorId)
  assertFragmentValid(projectDetailsSchema, patch, 'project.details')
  const [row] = await exec
    .update(projects)
    .set({
      project: sql`jsonb_set(${projects.project}, '{details}', COALESCE(${projects.project}->'details', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
      lastModifiedBy: actorId
    })
    .where(where)
    .returning()
  return row ?? null
}

export {
  insertProject,
  setProjectName,
  setProjectHabitatData,
  setProjectBaseline,
  setProjectFeature,
  setBaselineFeature,
  setProjectDetails
}
