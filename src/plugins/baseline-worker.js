import { config } from '../config.js'
import { createDispatcher } from '../services/jobs/dispatcher.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

// Spawns the async baseline-validation worker thread and exposes it to handlers
// as request.baselineDispatcher. Gated by asyncValidation.enabled so the default
// build spawns no thread and the enqueue routes report 503 — leaving the
// synchronous /baseline/validate route as the only validation path.
const baselineWorker = {
  plugin: {
    name: 'baseline-worker',
    version: '1.0.0',
    register(server) {
      if (!config.get('asyncValidation.enabled')) {
        logger.info(
          'Async baseline validation disabled (set ASYNC_VALIDATION_ENABLED=true to enable)'
        )
        return
      }

      const dispatcher = createDispatcher()
      logger.info('Async baseline validation worker started')

      server.decorate('request', 'baselineDispatcher', dispatcher)
      server.decorate('server', 'baselineDispatcher', dispatcher)

      server.events.on('stop', async () => {
        await dispatcher.close()
      })
    }
  }
}

export { baselineWorker }
