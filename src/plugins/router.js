import { health } from '../routes/health.js'
import { dbInfo } from '../routes/db-info.js'
import { getProjects, getProject } from '../routes/projects.js'

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, dbInfo, getProjects, getProject])
    }
  }
}

export { router }
