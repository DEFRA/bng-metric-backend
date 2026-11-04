import process from 'node:process'

import { createLogger } from './common/helpers/logging/logger.js'
import { startServer } from './common/helpers/start-server.js'

await startServer()

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.info('Unhandled rejection')
  logger.error(error)
  // Exit rather than only setting exitCode: a long-running server never exits
  // on its own, so it would carry on in an unknown state while /health still
  // passes. Exiting lets ECS replace the task.
  process.exit(1)
})
