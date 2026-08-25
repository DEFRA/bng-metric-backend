import Boom from '@hapi/boom'
import { and, asc, desc, eq } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'
import { insertProject, setProjectName } from '../db/persist-project.js'
import { resolveCurrentOrgContext } from '../db/org-context.js'
import { visibleToUser } from '../db/project-visibility.js'
import { projectListColumns } from '../db/project-list.js'
import { toProjectResponse } from '../utilities/project/to-project-response.js'
import { toProjectListResponses } from '../utilities/project/to-project-list-response.js'
import { paginationKeys } from '../validation/pagination.js'
import { projectSchema } from '../validation/project.js'
import { logPerf, perfNow, msSince } from '../common/helpers/perf-evidence.js'
import { habitatByIdColumns } from '../db/project-features.js'

/**
 * @openapi
 * /projects:
 *   get:
 *     tags:
 *       - Projects
 *     summary: List the requesting user's visible projects
 *     description: |
 *       Returns only projects the authenticated user owns that belong to the org
 *       context they are currently acting in (the token's
 *       `currentRelationshipId`) and whose latest role for that relationship is
 *       approved (status 3). Projects created under a different organisation are
 *       not returned, even when the user holds an approved role there too. A
 *       user with no current org context sees only their org-less (legacy)
 *       projects.
 *
 *       Each row carries `projectId` — an explicit alias of `id` — as the
 *       primary key for downstream relational consumers.
 *
 *       Rows are projected to the list columns only. The baseline /
 *       postIntervention document body is NOT included — read a single project
 *       via GET /projects/{id} for that.
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *           Returns an array of the user's visible projects, each carrying
 *           `id`, `projectId`, `project.name`, `has_baseline`, `createdAt`
 *           and `updatedAt`.
 *       401:
 *         description: Missing or invalid bearer token
 *
 * /projects/{id}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a project by ID
 *     description: |
 *       The response carries `projectId` — an explicit alias of `id` — as the
 *       primary key for downstream relational consumers. Nested features are
 *       keyed by their own `featureId`, which is stable across edits and across
 *       re-uploads that keep the same `ref`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Returns the project
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Project not found or not visible to the user
 *   patch:
 *     tags:
 *       - Projects
 *     summary: Update a project name
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *             required:
 *               - project
 *             properties:
 *               project:
 *                 type: object
 *                 required:
 *                   - name
 *                 properties:
 *                   name:
 *                     type: string
 *     responses:
 *       200:
 *         description: Returns the updated project
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Project not found or not visible to the user
 *
 * /projects/{projectId}/habitats/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single habitat document from a project's baseline
 *     security:
 *       - bearerAuth: []
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
 *     responses:
 *       200:
 *         description: Returns the habitat document
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Project or habitat not found
 *
 * /projects/new:
 *   post:
 *     tags:
 *       - Projects
 *     summary: Create a new project
 *     description: |
 *       The owner, org id and relationship id are derived from the verified
 *       Bearer token — the request body carries only the project document.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project
 *             properties:
 *               project:
 *                 type: object
 *     responses:
 *       200:
 *         description: Returns the created project
 *       401:
 *         description: Missing or invalid bearer token
 */
const getProjects = {
  method: 'GET',
  path: '/projects',
  options: {
    auth: 'defra-jwt',
    validate: {
      query: Joi.object({ ...paginationKeys })
    }
  },
  handler: async (request, _h) => {
    const credentials = request.auth.credentials
    const { limit, offset } = request.query
    const queryStart = perfNow()
    const rows = await request.drizzle
      .select(projectListColumns)
      .from(projects)
      .where(visibleToUser(credentials))
      // This endpoint had no order at all, which is fine for an unpaged dump but
      // not for limit/offset: without a total order Postgres may return the same
      // row on two pages and never return another.
      .orderBy(desc(projects.updatedAt), asc(projects.id))
      .limit(limit)
      .offset(offset)
    // Evidence (Item W2 — the project list filters on unindexed columns): the
    // response body itself is no longer the problem (BMD-933 projected it down
    // to four columns and bounded it with limit/offset), but bng.projects still
    // carries no index beyond its primary key, so the visibility predicate —
    // user_id plus a correlated subquery against bng.users for the current
    // relationship — is evaluated by a sequential scan whose cost grows with the
    // table, not with the page size the caller asked for.
    logPerf(request.logger, 'project-list-query', {
      endpoint: 'projects',
      rowCount: rows.length,
      limit,
      offset,
      queryMs: msSince(queryStart)
    })
    return toProjectListResponses(rows)
  }
}

const getProject = {
  method: 'GET',
  path: '/projects/{id}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        id: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, _h) => {
    const credentials = request.auth.credentials
    const { id } = request.params
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), visibleToUser(credentials)))

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${id} not found`)
    }

    return toProjectResponse(rows[0])
  }
}

const createProject = {
  method: 'POST',
  path: '/projects/new',
  options: {
    auth: 'defra-jwt',
    validate: {
      payload: Joi.object({
        project: projectSchema.required()
      })
    }
  },
  handler: async (request, _h) => {
    const claims = request.auth.credentials
    const { project } = request.payload
    // Resolved the same way the read scope resolves it (project-visibility.js),
    // so a project can never be stamped outside the context it is read through.
    const { relationshipId, orgId } = await resolveCurrentOrgContext(
      request.drizzle,
      claims
    )
    const row = await insertProject(request.drizzle, {
      project,
      userId: claims.sub,
      orgId,
      relationshipId
    })
    return toProjectResponse(row)
  }
}

const getHabitat = {
  method: 'GET',
  path: '/projects/{projectId}/habitats/{featureId}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required(),
        featureId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, _h) => {
    const credentials = request.auth.credentials
    const { projectId, featureId } = request.params
    // Item W4: Postgres returns just the matching habitat rather than the whole
    // project document — see the header of src/db/project-features.js.
    const rows = await request.drizzle
      .select(habitatByIdColumns({ featureId }))
      .from(projects)
      .where(and(eq(projects.id, projectId), visibleToUser(credentials)))

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${projectId} not found`)
    }

    const habitat = rows[0].habitat
    if (!habitat) {
      throw Boom.notFound(
        `Habitat ${featureId} not found in project ${projectId}`
      )
    }
    return habitat
  }
}

const updateProject = {
  method: 'PATCH',
  path: '/projects/{id}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        id: Joi.string().uuid().required()
      }),
      payload: Joi.object({
        project: Joi.object({
          name: Joi.string().trim().min(1).required()
        }).required()
      })
    }
  },
  handler: async (request, _h) => {
    const credentials = request.auth.credentials
    const { id } = request.params
    const {
      project: { name }
    } = request.payload
    const row = await setProjectName(
      request.drizzle,
      id,
      name,
      credentials.sub,
      and(eq(projects.id, id), visibleToUser(credentials))
    )
    if (!row) {
      throw Boom.notFound(`Project ${id} not found`)
    }
    return toProjectResponse(row)
  }
}

export { getProjects, getProject, getHabitat, createProject, updateProject }
