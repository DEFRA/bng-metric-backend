import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'

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
