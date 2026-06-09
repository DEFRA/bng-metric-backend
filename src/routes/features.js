import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { setBaselineFeature } from '../db/persist-project.js'
import { PG_LOCK_NOT_AVAILABLE } from '../db/postgres-error-codes.js'
import {
  APPLY_RESULT,
  applyFeatureUpdate
} from '../utilities/baseline/apply-feature-update.js'
import { findFeature } from '../utilities/baseline/find-feature.js'
import { projectFeatureIdParams } from './shared-params.js'

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
    // Preserve the legacy { type, feature } response shape — `findFeature`
    // now also returns the layer key, which callers outside this route
    // don't need.
    return { type: found.type, feature: found.feature }
  }
}

/**
 * @openapi
 * /projects/{projectId}/features/{featureId}:
 *   put:
 *     tags:
 *       - Projects
 *     summary: Save dropdown edits to one baseline feature
 *     description: |
 *       Persists habitat-type / condition (and broad-type for area habitats)
 *       selections, recomputes distinctiveness / condition score / units /
 *       status, refreshes the project-level units totals, then returns
 *       `{ type, feature }`. The feature type is discovered from the data,
 *       so a single endpoint handles habitats and hedgerows. Watercourse
 *       editing is not yet supported and returns 400 until the engine
 *       publishes watercourse scoring.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               broadType:
 *                 type: string
 *                 nullable: true
 *               habitatType:
 *                 type: string
 *                 nullable: true
 *               condition:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Returns the updated feature with its type
 *       400:
 *         description: Feature type is not editable via this endpoint (e.g. watercourse)
 *       404:
 *         description: Project or feature not found
 *       409:
 *         description: Another edit for this project is in progress
 */
const updateFeature = {
  method: 'PUT',
  path: '/projects/{projectId}/features/{featureId}',
  options: {
    validate: {
      params: projectFeatureIdParams,
      payload: Joi.object({
        broadType: Joi.string().trim().allow(null, '').optional(),
        habitatType: Joi.string().trim().allow(null, '').optional(),
        condition: Joi.string().trim().allow(null, '').optional()
      })
    }
  },
  handler: async (request, _h) => {
    const { projectId, featureId } = request.params

    try {
      return await request.drizzle.transaction((tx) =>
        runFeatureUpdate(tx, {
          projectId,
          featureId,
          edits: request.payload
        })
      )
    } catch (err) {
      if (err?.isBoom) {
        throw err
      }
      if (err?.code === PG_LOCK_NOT_AVAILABLE) {
        throw Boom.conflict('Another edit for this project is in progress')
      }
      throw err
    }
  }
}

async function runFeatureUpdate(tx, { projectId, featureId, edits }) {
  // Cap the wait on the project row lock so a stuck or pathologically slow
  // concurrent edit can't hang this request indefinitely.
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)

  // SELECT ... FOR UPDATE serializes concurrent edits to the same project:
  // without it, two concurrent PUTs to different features in the same
  // project would each read the JSONB, mutate locally, and write back —
  // last-write-wins drops one edit. Mirrors src/routes/habitats.js +
  // src/routes/baseline.js.
  const [row] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update')
    .limit(1)
  if (!row) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }

  const result = applyFeatureUpdate(row.project ?? {}, { featureId, edits })
  if (result.status === APPLY_RESULT.FEATURE_NOT_FOUND) {
    throw Boom.notFound(
      `Feature ${featureId} not found in project ${projectId}`
    )
  }
  if (result.status === APPLY_RESULT.UNSUPPORTED_TYPE) {
    throw Boom.badRequest(
      `Feature type ${result.type} is not editable via this endpoint`
    )
  }

  await setBaselineFeature(tx, projectId, {
    layer: result.layer,
    index: result.index,
    feature: result.feature,
    unitsTotals: result.unitsTotals
  })

  return { type: result.type, feature: result.feature }
}

export { getFeature, updateFeature, findFeature }
