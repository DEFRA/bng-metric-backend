import Boom from '@hapi/boom'

import { auditProjectChange } from '../common/helpers/audit-project-change.js'
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

    const saved = await setProjectDetails(
      request.drizzle,
      id,
      request.payload,
      sub,
      where
    )
    if (!saved) {
      throw Boom.notFound(`Project ${id} not found`)
    }
    auditProjectChange({
      actorId: sub,
      projectId: id,
      operation: 'updated',
      dataType: 'project.details'
    })
    return saved.project?.details ?? {}
  }
}

export { getProjectDetails, updateProjectDetails }
