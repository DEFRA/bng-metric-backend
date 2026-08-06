import { parentPort } from 'node:worker_threads'

import { createPool } from '../db/create-pool.js'
import { postgresOptionsFromConfig } from '../db/postgres-options.js'
import { createDrizzle } from '../db/index.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { createJobStore } from '../services/jobs/job-store.js'
import { runBaselineJob } from '../services/jobs/run-baseline-job.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

// Runs as a worker_thread spawned by src/services/jobs/dispatcher.js. It owns its
// own pg pool + drizzle instance (a pool cannot be shared across threads) and
// processes one enqueued job per message, off the main request event loop.
const logger = createLogger()
const pgPool = createPool(postgresOptionsFromConfig())
const drizzle = createDrizzle(pgPool)
const jobs = createJobStore(pgPool)

pgPool.on('error', (error) => {
  logger.error(`baseline worker pool error: ${error.message}`)
})

if (!parentPort) {
  throw new Error('baseline-worker must be run as a worker thread')
}

parentPort.on('message', async ({ jobId }) => {
  try {
    const message = await runBaselineJob(
      { jobs, drizzle, pgPool, logger },
      jobId
    )
    parentPort.postMessage(message)
  } catch (err) {
    // runBaselineJob records its own failures; this is a last-resort guard so a
    // throw here never leaves a holding-open enqueue handler waiting forever.
    logger.error(err, `baseline worker crashed handling job ${jobId}`)
    parentPort.postMessage({
      jobId,
      status: 'failed',
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      error: err.message
    })
  }
})
