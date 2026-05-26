import inert from '@hapi/inert'

import { config } from '../config.js'
import { health } from '../routes/health.js'
import { dbInfo } from '../routes/db-info.js'
import {
  getProjects,
  getProject,
  getHabitat,
  createProject,
  updateProject
} from '../routes/projects.js'
import { updateAreaHabitat } from '../routes/habitats.js'
import { initiateUpload, uploadStatus } from '../routes/upload.js'
import { validateBaseline } from '../routes/baseline.js'
import { getUserProjects } from '../routes/users.js'
import {
  getBroadHabitats,
  getHabitatTypes,
  getHabitatTypesByBroad,
  getConditions,
  getTradingRules
} from '../routes/reference.js'
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
        getHabitat,
        createProject,
        updateProject,
        updateAreaHabitat,
        initiateUpload,
        uploadStatus,
        validateBaseline,
        getUserProjects,
        getBroadHabitats,
        getHabitatTypes,
        getHabitatTypesByBroad,
        getConditions,
        getTradingRules
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
