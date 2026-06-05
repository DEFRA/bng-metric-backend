import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { PG_LOCK_NOT_AVAILABLE } from '../db/postgres-error-codes.js'
import {
  APPLY_RESULT,
  applyFeatureUpdate
} from '../utilities/baseline/apply-feature-update.js'
import { projectFeatureIdParams } from './shared-params.js'

/**
 * @openapi
 * /projects/{projectId}/habitats/{featureId}:
 *   put:
 *     tags:
 *       - Habitats
 *     summary: Save dropdown edits to one area habitat
 *     description: |
 *       Persists the user's broad-habitat / habitat-type / condition selections
 *       for a single area habitat, then recomputes the derived distinctiveness,
 *       condition score, habitat-unit total and Complete/Incomplete status
 *       before saving. Returns the updated habitat document.
 *
 *       Thin wrapper around the shared feature-update helper used by the
 *       unified `PUT /projects/{projectId}/features/{featureId}` endpoint -
 *       kept live so callers that still hit the typed URL keep working.
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: featureId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *         description: Returns the updated habitat document
 *       404:
 *         description: Project or habitat not found
 *       409:
 *         description: Another edit for this project is in progress
 */
/**
 * @openapi
 * /projects/{projectId}/post-intervention/habitats/{featureId}:
 *   put:
 *     tags:
 *       - Habitats
 *     summary: Save dropdown edits to one post-intervention area habitat
 *     description: |
 *       Persists the user's broad-habitat / habitat-type / condition selections
 *       for a single post-intervention area habitat, then recomputes the
 *       derived distinctiveness, condition score, habitat-unit total and
 *       Complete/Incomplete status before saving. Returns the updated habitat
 *       document.
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: featureId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *         description: Returns the updated habitat document
 *       404:
 *         description: Project or habitat not found
 *       409:
 *         description: Another edit for this project is in progress
 */
function createUpdateAreaHabitatRoute({ path, documentKey }) {
  return {
    method: 'PUT',
    path,
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
      const { broadType, habitatType, condition } = request.payload

      try {
        return await request.drizzle.transaction((tx) =>
          runUpdate(tx, {
            projectId,
            featureId,
            broadType,
            habitatType,
            condition,
            documentKey
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
}

const updateAreaHabitat = createUpdateAreaHabitatRoute({
  path: '/projects/{projectId}/habitats/{featureId}',
  documentKey: 'baseline'
})

const updatePostInterventionAreaHabitat = createUpdateAreaHabitatRoute({
  path: '/projects/{projectId}/post-intervention/habitats/{featureId}',
  documentKey: 'postIntervention'
})

async function runUpdate(
  tx,
  { projectId, featureId, broadType, habitatType, condition, documentKey }
) {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)

  const [row] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update')
    .limit(1)
  if (!row) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }

  const result = applyFeatureUpdate(row.project ?? {}, {
    featureId,
    edits: { broadType, habitatType, condition },
    expectedType: 'habitat',
    documentKey
  })
  if (
    result.status === APPLY_RESULT.FEATURE_NOT_FOUND ||
    result.status === APPLY_RESULT.FEATURE_WRONG_TYPE
  ) {
    throw Boom.notFound(
      `Habitat ${featureId} not found in project ${projectId}`
    )
  }

  await tx
    .update(projects)
    .set({ project: result.project })
    .where(eq(projects.id, projectId))

  return result.feature
}

export { updateAreaHabitat, updatePostInterventionAreaHabitat }
