import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'node:events'

import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()
const WORKER_URL = new URL('../../workers/baseline-worker.js', import.meta.url)

// Error message used when the enqueue handler's hold-open window elapses before
// the worker finishes. The handler catches it and returns 202 + a job id.
const HOLD_OPEN_TIMEOUT = 'hold-open-timeout'

// Owns the single baseline-validation worker thread and bridges it to request
// handlers. dispatch() hands off a job; waitFor() lets the enqueue handler hold
// its response open briefly so small files return their result inline.
function createDispatcher() {
  const bus = new EventEmitter()
  bus.setMaxListeners(0)
  let worker
  let closing = false

  function spawn() {
    worker = new Worker(WORKER_URL)
    worker.on('message', (message) => {
      bus.emit(message.jobId, message)
    })
    worker.on('error', (error) => {
      logger.error(error, `baseline worker thread error: ${error.message}`)
    })
    worker.on('exit', (code) => {
      if (!closing && code !== 0) {
        logger.error(`baseline worker exited with code ${code}; respawning`)
        spawn()
      }
    })
  }

  spawn()

  return {
    // Fire-and-forget: the terminal outcome is always persisted to the job row,
    // so a client can poll it even if nothing is waiting here.
    dispatch(jobId) {
      worker.postMessage({ jobId })
    },

    // Resolve with the worker's terminal message for this job, or reject with a
    // HOLD_OPEN_TIMEOUT error once timeoutMs elapses.
    waitFor(jobId, timeoutMs) {
      return new Promise((resolve, reject) => {
        const onDone = (message) => {
          clearTimeout(timer)
          resolve(message)
        }
        const timer = setTimeout(() => {
          bus.off(jobId, onDone)
          reject(new Error(HOLD_OPEN_TIMEOUT))
        }, timeoutMs)
        bus.once(jobId, onDone)
      })
    },

    async close() {
      closing = true
      await worker.terminate()
    }
  }
}

export { createDispatcher, HOLD_OPEN_TIMEOUT }
