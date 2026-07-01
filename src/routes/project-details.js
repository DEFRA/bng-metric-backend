import Boom from '@hapi/boom'
import { and, eq } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { setProjectDetails } from '../db/persist-project.js'
import { visibleToUser } from '../db/project-visibility.js'
import { projectDetailsSchema } from '../validation/project.js'

const getProjectDetails = {
  method: 'GET',
  path: '/projects/{id}/details',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({ id: Joi.string().uuid().required() })
    }
  },
  handler: async (request, _h) => {
    const { id } = request.params
    const { sub } = request.auth.credentials
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), visibleToUser(sub)))

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${id} not found`)
    }

    return rows[0].project?.details ?? {}
  }
}

const updateProjectDetails = {
  method: 'PATCH',
  path: '/projects/{id}/details',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({ id: Joi.string().uuid().required() }),
      payload: projectDetailsSchema.required()
    }
  },
  handler: async (request, _h) => {
    const { id } = request.params
    const { sub } = request.auth.credentials
    const where = and(eq(projects.id, id), visibleToUser(sub))

    const [existing] = await request.drizzle
      .select()
      .from(projects)
      .where(where)

    if (!existing) {
      throw Boom.notFound(`Project ${id} not found`)
    }

    const merged = { ...existing.project?.details, ...request.payload }
    const saved = await setProjectDetails(request.drizzle, id, merged, where)
    if (!saved) {
      throw Boom.notFound(`Project ${id} not found`)
    }
    return saved.project?.details ?? merged
  }
}

export { getProjectDetails, updateProjectDetails }
