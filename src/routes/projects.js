import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'

/**
 * @openapi
 * /projects:
 *   get:
 *     tags:
 *       - Projects
 *     summary: List all projects
 *     responses:
 *       200:
 *         description: Returns an array of projects
 *
 * /projects/{id}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a project by ID
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
 *       404:
 *         description: Project not found
 *   patch:
 *     tags:
 *       - Projects
 *     summary: Update a project name
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
 *       404:
 *         description: Project not found
 *
 * /projects/new:
 *   post:
 *     tags:
 *       - Projects
 *     summary: Create a new project
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project
 *               - userId
 *             properties:
 *               project:
 *                 type: object
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returns the created project
 */
const getProjects = {
  method: 'GET',
  path: '/projects',
  handler: async (request, _h) => {
    const rows = await request.drizzle.select().from(projects)
    return rows
  }
}

const getProject = {
  method: 'GET',
  path: '/projects/{id}',
  options: {
    validate: {
      params: Joi.object({
        id: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, _h) => {
    const { id } = request.params
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(eq(projects.id, id))

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${id} not found`)
    }

    return rows[0]
  }
}

const createProject = {
  method: 'POST',
  path: '/projects/new',
  options: {
    validate: {
      payload: Joi.object({
        project: Joi.object().required(),
        userId: Joi.string().required()
      }).rename('user_id', 'userId', { ignoreUndefined: true })
    }
  },
  handler: async (request, _h) => {
    const { project, userId } = request.payload
    const [row] = await request.drizzle
      .insert(projects)
      .values({ project, userId })
      .returning()
    return row
  }
}

const updateProject = {
  method: 'PATCH',
  path: '/projects/{id}',
  options: {
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
    const { id } = request.params
    const {
      project: { name }
    } = request.payload
    const [row] = await request.drizzle
      .update(projects)
      .set({
        project: sql`
          jsonb_set(
            ${projects.project},
            '{name}',
            to_jsonb(${name}::text),
            true
          )
        `
      })
      .where(eq(projects.id, id))
      .returning()

    if (!row) {
      throw Boom.notFound(`Project ${id} not found`)
    }

    return row
  }
}

export { getProjects, getProject, createProject, updateProject }
