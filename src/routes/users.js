import { eq } from 'drizzle-orm'
import { projects } from '../db/schema/index.js'

const getUserProjects = {
  method: 'GET',
  path: '/users/{userId}/projects',
  handler: async (request, _h) => {
    const { userId } = request.params
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))

    return rows
  }
}

export { getUserProjects }
