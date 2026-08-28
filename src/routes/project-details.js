import Boom from '@hapi/boom'
import { and, eq } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { setProjectDetails } from '../db/persist-project.js'
import { visibleToUser } from '../db/project-visibility.js'
import { projectDetailsColumns } from '../db/project-details-columns.js'
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
    const credentials = request.auth.credentials
    // Postgres returns just the details sub-document rather than the whole
    // project JSONB — see the header of src/db/project-details-columns.js.
    const rows = await request.drizzle
      .select(projectDetailsColumns)
      .from(projects)
      .where(and(eq(projects.id, id), visibleToUser(credentials)))

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${id} not found`)
    }

    return rows[0].details ?? {}
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
    const credentials = request.auth.credentials
    const where = and(eq(projects.id, id), visibleToUser(credentials))

    const saved = await setProjectDetails(
      request.drizzle,
      id,
      request.payload,
      credentials.sub,
      where
    )
    if (!saved) {
      throw Boom.notFound(`Project ${id} not found`)
    }
    return saved.details ?? {}
  }
}

export { getProjectDetails, updateProjectDetails }
