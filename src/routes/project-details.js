import Boom from '@hapi/boom'
import { and, eq } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { setProjectDetails } from '../db/persist-project.js'
import { visibleToUser } from '../db/project-visibility.js'
import { projectDetailsColumns } from '../db/project-details-columns.js'
import { projectDetailsSchema } from '../validation/project.js'
import { resolveLocalPlanningAuthority } from '../services/local-planning-authorities.js'

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

// The project details page saves the project name with the other details
// (BMD-849), so the payload may carry `name` beside them. It is held at
// project.name, not in project.details, and is written in the same UPDATE so
// either all of the page is saved or none of it is.
const updateProjectDetailsPayloadSchema = projectDetailsSchema
  .keys({
    name: Joi.string()
      .trim()
      .min(1)
      .description(
        'Project name, saved with the details. Omit it to leave the name as it is.'
      )
  })
  .required()

const updateProjectDetails = {
  method: 'PATCH',
  path: '/projects/{id}/details',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({ id: Joi.string().uuid().required() }),
      payload: updateProjectDetailsPayloadSchema
    }
  },
  handler: async (request, _h) => {
    const { id } = request.params
    const credentials = request.auth.credentials
    const where = and(eq(projects.id, id), visibleToUser(credentials))
    const { name, ...patch } = request.payload
    const details = await resolveLocalPlanningAuthority(request.drizzle, patch)

    const saved = await setProjectDetails(
      request.drizzle,
      id,
      details,
      credentials.sub,
      where,
      { name }
    )
    if (!saved) {
      throw Boom.notFound(`Project ${id} not found`)
    }
    return saved.details ?? {}
  }
}

export { getProjectDetails, updateProjectDetails }
