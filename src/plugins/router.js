import { health } from '../routes/health.js'
import { dbInfo } from '../routes/db-info.js'

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, dbInfo])
    }
  }
}

export { router }
