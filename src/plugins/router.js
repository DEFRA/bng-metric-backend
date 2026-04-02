import { health } from '../routes/health.js'
import { dbInfo } from '../routes/db-info.js'
import { habitats, habitat } from '../routes/habitats.js'

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, dbInfo, habitats, habitat])
    }
  }
}

export { router }
