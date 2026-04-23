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

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
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
    }
  }
}

export { router }
