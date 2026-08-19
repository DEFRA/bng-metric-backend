import { asc, desc, sql } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'
import { visibleToUser } from '../db/project-visibility.js'
import { projectListColumns } from '../db/project-list.js'
import { paginationKeys } from '../validation/pagination.js'
import { toProjectListResponses } from '../utilities/project/to-project-list-response.js'

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
 *       projects the user owns that belong to the org context they are currently
 *       acting in (the token's `currentRelationshipId`) and whose latest role for
 *       that relationship is approved (status 3). Projects created under a
 *       different organisation are not returned, even when the user holds an
 *       approved role there too. A user with no current org context sees only
 *       their org-less (legacy) projects.
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
 *       - in: query
 *         name: limit
 *         description: Maximum number of projects to return (1-500).
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *           default: 100
 *       - in: query
 *         name: offset
 *         description: Number of projects to skip before returning results.
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: |
 *           Returns an array of the user's visible projects, projected to the
 *           list columns only — `id`, `projectId`, `project.name`,
 *           `hasBaseline`, `createdAt`, `updatedAt`. The baseline /
 *           postIntervention document body is NOT included; read a single
 *           project via GET /projects/{id} for that.
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
        order: Joi.string().valid('asc', 'desc').default('desc'),
        ...paginationKeys
      })
    }
  },
  handler: async (request, _h) => {
    const credentials = request.auth.credentials
    const { sort, order, limit, offset } = request.query

    const rows = await request.drizzle
      .select(projectListColumns)
      .from(projects)
      .where(visibleToUser(credentials))
      // The id tiebreak keeps the order total: rows sharing a timestamp (or a
      // name) would otherwise be free to swap places between pages, so an
      // offset could skip one row and repeat another.
      .orderBy(orderDirections[order](sortColumns[sort]), asc(projects.id))
      .limit(limit)
      .offset(offset)

    return toProjectListResponses(rows)
  }
}

export { getUserProjects }
