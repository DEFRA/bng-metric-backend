import inert from '@hapi/inert'

import { config } from '../config.js'
import { health } from '../routes/health.js'
import { postAuthSession } from '../routes/auth.js'
import {
  getProjects,
  getProject,
  getHabitat,
  createProject,
  updateProject
} from '../routes/projects.js'
import {
  updatePostInterventionWatercourse,
  updatePostInterventionHedgerow,
  updateAreaHabitat,
  updatePostInterventionAreaHabitat,
  updatePostInterventionTree
} from '../routes/habitats.js'
import {
  getFeature,
  getPostInterventionFeature,
  updateFeature,
  updatePostInterventionFeatureRef
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
  getWatercourseCreation,
  getHedgerowCreation,
  getAreaCreation,
  getTreeCreation,
  getTreeEnhancement,
  getAreaEnhancement,
  getBroadHabitats,
  getLocalPlanningAuthorities,
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
import { RATE_LIMITED, withRateLimit } from './rate-limit.js'

const router = {
  plugin: {
    name: 'router',
    register: async (server, _options) => {
      // The costly routes carry rate limits (plugins/rate-limit.js); the
      // rest are left to the CDP limit.
      server.route([
        health,
        postAuthSession,
        getProjects,
        getProject,
        getHabitat,
        createProject,
        updateProject,
        updatePostInterventionWatercourse,
        updatePostInterventionHedgerow,
        updateAreaHabitat,
        updatePostInterventionAreaHabitat,
        updatePostInterventionTree,
        getFeature,
        getPostInterventionFeature,
        updateFeature,
        updatePostInterventionFeatureRef,
        withRateLimit(initiateUpload, RATE_LIMITED.uploadInitiate),
        uploadStatus,
        withRateLimit(validateBaseline, RATE_LIMITED.validate),
        withRateLimit(validatePostIntervention, RATE_LIMITED.validate),
        getUserProjects,
        withRateLimit(getProjectReport, RATE_LIMITED.report),
        getProjectDetails,
        updateProjectDetails,
        getWatercourseCreation,
        getHedgerowCreation,
        getAreaCreation,
        getTreeCreation,
        getTreeEnhancement,
        getAreaEnhancement,
        getBroadHabitats,
        getLocalPlanningAuthorities,
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

      // Swagger API documentation (opt-in via USE_SWAGGER env var)
      if (config.get('useSwagger')) {
        await server.register([inert])
        await server.register([swagger])
      }
    }
  }
}

export { router }
