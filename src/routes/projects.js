import Boom from '@hapi/boom'
import { eq } from 'drizzle-orm'
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
        id: Joi.string().uuid().required(),
        project: Joi.object().required(),
        userId: Joi.string().required()
      }).rename('user_id', 'userId', { ignoreUndefined: true })
    }
  },
  handler: async (request, _h) => {
    const { id, project, userId } = request.payload
    const [row] = await request.drizzle
      .insert(projects)
      .values({ id, project, userId })
      .returning()
    return row
  }
}

export { getProjects, getProject, createProject }
