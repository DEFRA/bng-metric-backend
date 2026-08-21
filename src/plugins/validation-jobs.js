import { config } from '../config.js'
import { createValidationJobDispatcher } from '../services/validation-jobs/dispatcher.js'

/**
 * Runs the validation job dispatcher for the lifetime of the server.
 *
 * Registered only when async validation is enabled, so an instance with the
 * flag off neither polls the table nor claims work — which is what lets the
 * flag be turned on for one environment at a time.
 *
 * Must be registered after the postgres plugin: it takes the pool and Drizzle
 * handle the plugin decorates onto the server.
 */
const validationJobs = {
  plugin: {
    name: 'validation-jobs',
    version: '1.0.0',
    register: async function (server) {
      const dispatcher = createValidationJobDispatcher({
        drizzle: server.drizzle,
        pgPool: server.pg,
        settings: {
          maxConcurrentJobs: config.get('asyncValidation.maxConcurrentJobs'),
          pollIntervalMs: config.get('asyncValidation.pollIntervalMs'),
          leaseMs: config.get('asyncValidation.leaseMs'),
          maxAttempts: config.get('asyncValidation.maxAttempts'),
          retentionMs: config.get('asyncValidation.retentionMs')
        }
      })

      server.decorate('server', 'validationJobDispatcher', dispatcher)
      server.decorate('request', 'validationJobDispatcher', dispatcher)

      server.events.on('start', () => dispatcher.start())
      server.events.on('stop', () => dispatcher.stop())
    }
  }
}

export { validationJobs }
