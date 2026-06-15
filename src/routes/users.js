import { asc, desc, sql } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'
import { visibleToUser } from '../db/project-visibility.js'

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
 *     summary: List the authenticated user's visible projects
 *     description: |
 *       The user is taken from the verified Bearer token (`sub`); the {userId}
 *       path segment is retained for routing only and is not trusted. Returns
 *       projects the user owns whose latest role for the project's relationship
 *       is approved (status 3), plus their legacy projects with no relationship.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Returns an array of the user's visible projects
 *       401:
 *         description: Missing or invalid bearer token
 */
const getUserProjects = {
  method: 'GET',
  path: '/users/{userId}/projects',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        // Defra ID `sub` is not a UUID; the value is not trusted (we use the
        // token `sub`), so accept any non-empty string for routing.
        userId: Joi.string().required()
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
    const { sub } = request.auth.credentials
    const { sort, order } = request.query

    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(visibleToUser(sub))
      .orderBy(orderDirections[order](sortColumns[sort]))

    return rows
  }
}

export { getUserProjects }
