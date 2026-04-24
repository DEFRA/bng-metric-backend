import { asc, desc, eq, sql } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'

const orderDirections = { asc, desc }

const sortColumns = {
  created_at: projects.createdAt,
  updated_at: projects.updatedAt,
  name: sql`${projects.project}->>'name'`
}

/**
 * @openapi
 * /users/{userId}/projects:
 *   get:
 *     tags:
 *       - Users
 *     summary: List projects for a user
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [created_at, updated_at, name]
 *           default: updated_at
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Returns an array of projects belonging to the user
 */
const getUserProjects = {
  method: 'GET',
  path: '/users/{userId}/projects',
  options: {
    validate: {
      params: Joi.object({
        userId: Joi.string().uuid().required()
      }),
      query: Joi.object({
        sort: Joi.string()
          .valid('created_at', 'updated_at', 'name')
          .default('updated_at'),
        order: Joi.string().valid('asc', 'desc').default('desc')
      })
    }
  },
  handler: async (request, _h) => {
    const { userId } = request.params
    const { sort, order } = request.query

    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(orderDirections[order](sortColumns[sort]))

    return rows
  }
}

export { getUserProjects }
