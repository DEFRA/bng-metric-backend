import Boom from '@hapi/boom'
import { eq } from 'drizzle-orm'
import { projects } from '../db/schema/index.js'
import { projectFeatureIdParams } from './shared-params.js'

const FEATURE_LAYERS = [
  { type: 'habitat', key: 'habitats' },
  { type: 'hedgerow', key: 'hedgerows' },
  { type: 'watercourse', key: 'watercourses' }
]

/**
 * Locate a feature in a baseline document by featureId, returning the layer
 * it belongs to. Used by the unified feature endpoint so callers identify a
 * feature by its UUID alone — the type comes from the data, not the URL.
 *
 * Relies on featureIds being unique across habitats, hedgerows and
 * watercourses (they're generated as UUIDs at baseline-validate time, so
 * collisions are vanishingly unlikely). If a duplicate is ever observed it
 * indicates upstream data corruption and we throw rather than silently
 * returning the wrong layer's feature.
 *
 * @param {object} baseline
 * @param {string} featureId
 * @returns {{ type: string, feature: object } | null}
 * @throws {Error} when the same featureId appears in more than one layer
 */
function findFeature(baseline, featureId) {
  if (!baseline) {
    return null
  }
  const matches = []
  for (const { type, key } of FEATURE_LAYERS) {
    const found = baseline[key]?.find((f) => f?.featureId === featureId)
    if (found) {
      matches.push({ type, feature: found })
    }
  }
  if (matches.length > 1) {
    throw new Error(
      `featureId ${featureId} appears in multiple layers: ${matches
        .map((m) => m.type)
        .join(', ')}`
    )
  }
  return matches[0] ?? null
}

/**
 * @openapi
 * /projects/{projectId}/features/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single baseline feature regardless of layer
 *     description: |
 *       Scans habitats, hedgerows and watercourses and returns the matching
 *       feature with a `type` discriminator. Lets the frontend address any
 *       baseline feature by featureId alone — the data tells the caller what
 *       kind of feature it is.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     responses:
 *       200:
 *         description: Returns the feature with its type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [habitat, hedgerow, watercourse]
 *                 feature:
 *                   type: object
 *       404:
 *         description: Project or feature not found
 */
/**
 * @openapi
 * /projects/{projectId}/post-intervention/features/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single post-intervention feature regardless of layer
 *     description: |
 *       Scans post-intervention habitats, hedgerows and watercourses and
 *       returns the matching feature with a `type` discriminator. Lets the
 *       frontend address any post-intervention feature by featureId alone.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     responses:
 *       200:
 *         description: Returns the feature with its type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [habitat, hedgerow, watercourse]
 *                 feature:
 *                   type: object
 *       404:
 *         description: Project or feature not found
 */
const getFeature = {
  method: 'GET',
  path: '/projects/{projectId}/features/{featureId}',
  options: {
    validate: {
      params: projectFeatureIdParams
    }
  },
  handler: async (request, _h) => {
    const { projectId, featureId } = request.params
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${projectId} not found`)
    }

    const baseline = rows[0].project?.baseline
    const found = findFeature(baseline, featureId)
    if (!found) {
      throw Boom.notFound(
        `Feature ${featureId} not found in project ${projectId}`
      )
    }
    return found
  }
}

function createGetFeatureRoute({ path, documentKey }) {
  return {
    ...getFeature,
    path,
    handler: async (request, _h) => {
      const { projectId, featureId } = request.params
      const rows = await request.drizzle
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))

      if (rows.length === 0) {
        throw Boom.notFound(`Project ${projectId} not found`)
      }

      const featureSet = rows[0].project?.[documentKey]
      const found = findFeature(featureSet, featureId)
      if (!found) {
        throw Boom.notFound(
          `Feature ${featureId} not found in project ${projectId}`
        )
      }
      return found
    }
  }
}

const getPostInterventionFeature = createGetFeatureRoute({
  path: '/projects/{projectId}/post-intervention/features/{featureId}',
  documentKey: 'postIntervention'
})

export { getFeature, getPostInterventionFeature, findFeature }
