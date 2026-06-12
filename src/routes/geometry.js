import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'

import {
  projects,
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses,
  postInterventionRedLine,
  postInterventionHabitats,
  postInterventionHedgerows,
  postInterventionWatercourses
} from '../db/schema/index.js'

const WGS84_SRID = 4326

const PROPOSED_BROAD_HABITAT_KEYS = [
  'Proposed Broad Habitat Type',
  'Proposed_Broad_Habitat_Type'
]
const PROPOSED_HABITAT_KEYS = ['Proposed Habitat Type', 'Proposed_Habitat_Type']
const PROPOSED_CONDITION_KEYS = ['Proposed Condition', 'Proposed_Condition']
const PROPOSED_DISTINCTIVENESS_KEYS = [
  'Proposed Distinctiveness',
  'Proposed_Distinctiveness'
]
const PROPOSED_HEDGE_TYPE_KEYS = ['Proposed Hedge Type', 'Proposed_Hedge_Type']
const PROPOSED_RIVER_TYPE_KEYS = ['Proposed River Type', 'Proposed_River_Type']

const LAYER_BASELINE = {
  redLine: baselineRedLine,
  habitats: baselineHabitats,
  hedgerows: baselineHedgerows,
  watercourses: baselineWatercourses
}

const LAYER_POST_INTERVENTION = {
  redLine: postInterventionRedLine,
  habitats: postInterventionHabitats,
  hedgerows: postInterventionHedgerows,
  watercourses: postInterventionWatercourses
}

function pickRawProp(rawProperties, candidates) {
  if (!rawProperties) {
    return null
  }
  for (const key of candidates) {
    if (rawProperties[key] != null && rawProperties[key] !== '') {
      return rawProperties[key]
    }
  }
  return null
}

function habitatAttributes(doc, stage) {
  const raw = doc.properties ?? {}
  const proposedBroad =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_BROAD_HABITAT_KEYS)
      : null
  const proposedHabitat =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_HABITAT_KEYS)
      : null
  const proposedCondition =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_CONDITION_KEYS)
      : null
  const proposedDistinctiveness =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_DISTINCTIVENESS_KEYS)
      : null

  return {
    broadHabitatType: proposedBroad ?? doc.broadType ?? null,
    habitatType: proposedHabitat ?? doc.type ?? null,
    condition: proposedCondition ?? doc.condition ?? null,
    distinctiveness: proposedDistinctiveness ?? doc.distinctiveness ?? null,
    retentionCategory: doc.retentionCategory ?? null
  }
}

function hedgerowAttributes(doc, stage) {
  const raw = doc.properties ?? {}
  const proposedType =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_HEDGE_TYPE_KEYS)
      : null
  const proposedCondition =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_CONDITION_KEYS)
      : null
  const proposedDistinctiveness =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_DISTINCTIVENESS_KEYS)
      : null

  return {
    habitatType: proposedType ?? doc.type ?? null,
    condition: proposedCondition ?? doc.condition ?? null,
    distinctiveness: proposedDistinctiveness ?? doc.distinctiveness ?? null,
    retentionCategory: doc.retentionCategory ?? null
  }
}

function watercourseAttributes(doc, stage) {
  const raw = doc.properties ?? {}
  const proposedType =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_RIVER_TYPE_KEYS)
      : null
  const proposedCondition =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_CONDITION_KEYS)
      : null
  const proposedDistinctiveness =
    stage === 'postIntervention'
      ? pickRawProp(raw, PROPOSED_DISTINCTIVENESS_KEYS)
      : null

  return {
    habitatType: proposedType ?? doc.type ?? null,
    condition: proposedCondition ?? doc.condition ?? null,
    distinctiveness: proposedDistinctiveness ?? doc.distinctiveness ?? null,
    retentionCategory: doc.retentionCategory ?? null
  }
}

function buildRefLookup(documents, attributeBuilder, stage) {
  const lookup = new Map()
  for (const doc of documents ?? []) {
    if (doc?.ref != null) {
      lookup.set(doc.ref, attributeBuilder(doc, stage))
    }
  }
  return lookup
}

function rowsToFeatureCollection(rows, attrLookup) {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => {
      const attrs = attrLookup?.get(row.ref) ?? {}
      return {
        type: 'Feature',
        id: row.id,
        properties: { id: row.id, ref: row.ref ?? null, ...attrs },
        geometry: row.geometry
      }
    })
  }
}

async function selectLayer(
  drizzle,
  table,
  projectId,
  { includeRef = true } = {}
) {
  const refColumn = includeRef ? sql`, ref` : sql``
  const result = await drizzle.execute(sql`
    SELECT
      id::text AS id${refColumn},
      ST_AsGeoJSON(ST_Transform(geom, ${WGS84_SRID}::integer))::json AS geometry
    FROM ${table}
    WHERE project_id = ${projectId}::uuid
  `)
  return result.rows ?? result
}

async function loadGeometryForStage(request, projectId, stage) {
  const tables = stage === 'baseline' ? LAYER_BASELINE : LAYER_POST_INTERVENTION

  const [projectRow] = await request.drizzle
    .select({ id: projects.id, project: projects.project })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!projectRow) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }

  const stageDoc = projectRow.project?.[stage] ?? {}
  const habitatLookup = buildRefLookup(
    stageDoc.habitats,
    habitatAttributes,
    stage
  )
  const hedgerowLookup = buildRefLookup(
    stageDoc.hedgerows,
    hedgerowAttributes,
    stage
  )
  const watercourseLookup = buildRefLookup(
    stageDoc.watercourses,
    watercourseAttributes,
    stage
  )

  const [redLineRows, habitatRows, hedgerowRows, watercourseRows] =
    await Promise.all([
      selectLayer(request.drizzle, tables.redLine, projectId, {
        includeRef: false
      }),
      selectLayer(request.drizzle, tables.habitats, projectId),
      selectLayer(request.drizzle, tables.hedgerows, projectId),
      selectLayer(request.drizzle, tables.watercourses, projectId)
    ])

  return {
    crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    redLine: redLineRows.length ? rowsToFeatureCollection(redLineRows) : null,
    areaHabitats: rowsToFeatureCollection(habitatRows, habitatLookup),
    hedgerows: rowsToFeatureCollection(hedgerowRows, hedgerowLookup),
    watercourses: rowsToFeatureCollection(watercourseRows, watercourseLookup)
  }
}

/**
 * @openapi
 * /projects/{projectId}/baseline/geometry:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Baseline spatial layers for map rendering
 *     description: |
 *       Returns the persisted baseline geometries (red line, area habitats,
 *       hedgerows, watercourses) as GeoJSON FeatureCollections reprojected to
 *       EPSG:4326, with per-feature symbology attributes joined from the
 *       project JSONB by ref. Intended for browser map rendering — see BMD-546.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *     responses:
 *       200:
 *         description: Layers as GeoJSON FeatureCollections (WGS84)
 *       404:
 *         description: Project not found
 */
const getBaselineGeometry = {
  method: 'GET',
  path: '/projects/{projectId}/baseline/geometry',
  options: {
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, _h) => {
    const { projectId } = request.params
    return loadGeometryForStage(request, projectId, 'baseline')
  }
}

/**
 * @openapi
 * /projects/{projectId}/post-intervention/geometry:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Post-intervention spatial layers for map rendering
 *     description: |
 *       Mirrors the baseline endpoint but reads from the post-intervention
 *       feature tables and the project.postIntervention JSONB. Property values
 *       prefer the Proposed * columns from the raw GeoPackage row, falling
 *       back to the document's stored type/condition fields.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *     responses:
 *       200:
 *         description: Layers as GeoJSON FeatureCollections (WGS84)
 *       404:
 *         description: Project not found
 */
const getPostInterventionGeometry = {
  method: 'GET',
  path: '/projects/{projectId}/post-intervention/geometry',
  options: {
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, _h) => {
    const { projectId } = request.params
    return loadGeometryForStage(request, projectId, 'postIntervention')
  }
}

export { getBaselineGeometry, getPostInterventionGeometry }
