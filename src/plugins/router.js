import inert from '@hapi/inert'

import { config } from '../config.js'
import { health } from '../routes/health.js'
import { dbInfo } from '../routes/db-info.js'
import { postAuthSession } from '../routes/auth.js'
import {
  getProjects,
  getProject,
  getHabitat,
  createProject,
  updateProject
} from '../routes/projects.js'
import {
  updateAreaHabitat,
  updatePostInterventionAreaHabitat
} from '../routes/habitats.js'
import {
  getFeature,
  getPostInterventionFeature,
  updateFeature
} from '../routes/features.js'
import { initiateUpload, uploadStatus } from '../routes/upload.js'
import {
  validateBaseline,
  validatePostIntervention
} from '../routes/baseline.js'
import { getUserProjects } from '../routes/users.js'
import {
  getBroadHabitats,
  getHabitatTypes,
  getHabitatTypesByBroad,
  getConditions,
  getHedgerowTypes,
  getWatercourseEncroachments,
  getWatercourseTypes,
  getTradingRules
} from '../routes/reference.js'
import { swagger } from '../common/helpers/swagger.js'

const router = {
  plugin: {
    name: 'router',
    register: async (server, _options) => {
      server.route([
        health,
        postAuthSession,
        getProjects,
        getProject,
        getHabitat,
        createProject,
        updateProject,
        updateAreaHabitat,
        updatePostInterventionAreaHabitat,
        getFeature,
        getPostInterventionFeature,
        updateFeature,
        initiateUpload,
        uploadStatus,
        validateBaseline,
        validatePostIntervention,
        getUserProjects,
        getBroadHabitats,
        getHabitatTypes,
        getHabitatTypesByBroad,
        getConditions,
        getHedgerowTypes,
        getWatercourseTypes,
        getWatercourseEncroachments,
        getTradingRules
      ])

      // /db-info is a DB-introspection diagnostic — keep it out of the
      // production route table entirely (it is removed, not just access-gated).
      // See docs/auth-route-policy.md.
      if (config.get('cdpEnvironment') !== 'prod') {
        server.route(dbInfo)
      }

      // Swagger API documentation (opt-in via USE_SWAGGER env var)
      if (config.get('useSwagger')) {
        await server.register([inert])
        await server.register([swagger])
      }
    }
  }
}

export { router }
