import Boom from '@hapi/boom'
import { eq } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'

const getProjects = {
  method: 'GET',
  path: '/projects',
  handler: async (request, _h) => {
    const ctx = request.app.userContext
    const query = request.drizzle.select().from(projects)
    const rows = ctx
      ? await query.where(eq(projects.userId, ctx.userId))
      : await query
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

    const ctx = request.app.userContext
    if (ctx && rows[0].userId !== ctx.userId) {
      throw Boom.forbidden()
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

    const ctx = request.app.userContext
    if (ctx && ctx.userId !== userId) {
      throw Boom.forbidden()
    }

    const [row] = await request.drizzle
      .insert(projects)
      .values({ project, userId })
      .returning()
    return row
  }
}

export { getProjects, getProject, createProject }
