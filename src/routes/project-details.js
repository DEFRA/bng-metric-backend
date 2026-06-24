import Boom from '@hapi/boom'
import { eq } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { setProjectDetails } from '../db/persist-project.js'
import { projectDetailsSchema } from '../validation/project.js'

const getProjectDetails = {
  method: 'GET',
  path: '/project-details/{id}',
  options: {
    validate: {
      params: Joi.object({ id: Joi.string().uuid().required() })
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

    return rows[0].project?.details ?? {}
  }
}

const updateProjectDetails = {
  method: 'PATCH',
  path: '/project-details/{id}',
  options: {
    validate: {
      params: Joi.object({ id: Joi.string().uuid().required() }),
      payload: projectDetailsSchema.required()
    }
  },
  handler: async (request, _h) => {
    const { id } = request.params
    const row = await setProjectDetails(request.drizzle, id, request.payload)
    if (!row) {
      throw Boom.notFound(`Project ${id} not found`)
    }
    return row.project?.details ?? {}
  }
}

export { getProjectDetails, updateProjectDetails }
