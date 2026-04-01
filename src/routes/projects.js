import Boom from '@hapi/boom'
import { eq } from 'drizzle-orm'
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

export { getProjects, getProject }
