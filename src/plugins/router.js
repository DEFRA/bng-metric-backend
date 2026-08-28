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
import { validateBaseline } from '../routes/baseline.js'
import { validatePostIntervention } from '../routes/post-intervention.js'
import { getUserProjects } from '../routes/users.js'
import { getProjectReport } from '../routes/report.js'
import {
  getProjectDetails,
  updateProjectDetails
} from '../routes/project-details.js'
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
import { osTiles, osTilesEnabled } from './os-tiles.js'

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
        getProjectReport,
        getProjectDetails,
        updateProjectDetails,
        getBroadHabitats,
        getHabitatTypes,
        getHabitatTypesByBroad,
        getConditions,
        getHedgerowTypes,
        getWatercourseTypes,
        getWatercourseEncroachments,
        getTradingRules
      ])

      // The OS tiles routes exist only where an OS Maps key does — see the
      // header of plugins/os-tiles.js. Without one every tile would 401 from
      // Ordnance Survey, so the absence of a key shows up as the absence of a
      // route rather than as an endpoint that always fails.
      if (osTilesEnabled()) {
        await server.register([osTiles])
      }

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
