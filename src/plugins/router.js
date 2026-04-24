import inert from '@hapi/inert'

import { config } from '../config.js'
import { health } from '../routes/health.js'
import { dbInfo } from '../routes/db-info.js'
import {
  getProjects,
  getProject,
  createProject,
  updateProject
} from '../routes/projects.js'
import { initiateUpload, uploadStatus } from '../routes/upload.js'
import { validateBaseline } from '../routes/baseline.js'
import { getUserProjects } from '../routes/users.js'
import { swagger } from '../common/helpers/swagger.js'

const router = {
  plugin: {
    name: 'router',
    register: async (server, _options) => {
      server.route([
        health,
        dbInfo,
        getProjects,
        getProject,
        createProject,
        updateProject,
        initiateUpload,
        uploadStatus,
        validateBaseline,
        getUserProjects
      ])

      // Swagger API documentation (opt-in via USE_SWAGGER env var)
      if (config.get('useSwagger')) {
        await server.register([inert])
        await server.register([swagger])
      }
    }
  }
}

export { router }
