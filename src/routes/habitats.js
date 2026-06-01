import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'
import { PG_LOCK_NOT_AVAILABLE } from '../db/postgres-error-codes.js'
import { recomputeAreaHabitat } from '../validation/baseline/unit-calculation.js'

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
const updateAreaHabitat = {
  method: 'PUT',
  path: '/projects/{projectId}/habitats/{featureId}',
  options: {
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required(),
        featureId: Joi.string().uuid().required()
      }),
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
          condition
        })
      )
    } catch (err) {
      if (err?.isBoom) {
        throw err
      } else if (err?.code === PG_LOCK_NOT_AVAILABLE) {
        // SELECT ... FOR UPDATE waited past lock_timeout for another edit.
        throw Boom.conflict('Another edit for this project is in progress')
      } else {
        throw err
      }
    }
  }
}

async function runUpdate(
  tx,
  { projectId, featureId, broadType, habitatType, condition }
) {
  // Cap the wait on the project row lock so a stuck or pathologically slow
  // concurrent edit can't hang this request indefinitely.
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)

  // SELECT ... FOR UPDATE serialises concurrent edits to the same project.
  // Without this, two concurrent PUTs (even to different habitats within the
  // same project) would each read the project JSONB, mutate one habitat in
  // JS, and write the whole document back — last-write-wins drops the other
  // edit. Mirrors the pattern in src/routes/baseline.js.
  const [row] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update')
    .limit(1)
  if (!row) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }

  const project = row.project ?? {}
  const habitats = project.baseline?.habitats ?? []
  const habitatIndex = habitats.findIndex((h) => h?.featureId === featureId)
  if (habitatIndex === -1) {
    throw Boom.notFound(
      `Habitat ${featureId} not found in project ${projectId}`
    )
  }

  const existing = habitats[habitatIndex]
  const newBroadType = blankToNull(broadType)
  const newHabitatType = blankToNull(habitatType)
  const newCondition = blankToNull(condition)
  const derived = recomputeAreaHabitat({
    broadType: newBroadType,
    habitatType: newHabitatType,
    condition: newCondition,
    sizeSquareMetres: existing.sizeSquareMetres ?? null
  })

  const updatedHabitat = {
    ...existing,
    broadType: newBroadType,
    type: newHabitatType,
    condition: newCondition,
    distinctiveness: derived.distinctiveness,
    distinctivenessScore: derived.distinctivenessScore,
    conditionScore: derived.conditionScore,
    habitatUnits: derived.habitatUnits,
    status: derived.status
  }

  const updatedHabitats = habitats.slice()
  updatedHabitats[habitatIndex] = updatedHabitat
  const updatedProject = {
    ...project,
    baseline: {
      ...project.baseline,
      habitats: updatedHabitats
    }
  }

  await tx
    .update(projects)
    .set({ project: updatedProject })
    .where(eq(projects.id, projectId))

  return updatedHabitat
}

function blankToNull(value) {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed === '' ? null : trimmed
}

export { updateAreaHabitat }
