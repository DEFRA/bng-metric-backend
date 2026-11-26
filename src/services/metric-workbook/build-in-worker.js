import { Worker } from 'node:worker_threads'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from '../../config.js'

/**
 * Builds metric workbooks (BMD-1141) off the main thread.
 *
 * Writing a workbook is about a second of synchronous work: unzipping the
 * metric template, rewriting several MB of sheet XML and zipping it again. On
 * the main thread the server answered nothing else for that second, so a run
 * of downloads could stall every other request. Each build now runs on a
 * worker thread of its own, which exits when the build is done.
 *
 * A fresh worker per build, rather than a pool kept warm, because nothing is
 * worth keeping between builds: the template is a fixed ~480 MB to unpack
 * however many rows are written, and a worker that has finished has given all
 * of it back. Start-up costs about 300 ms on a build of about a second, which
 * a download can afford.
 *
 * Three limits, all from `metricWorkbook` in config:
 *
 *  - CONCURRENCY. Builds at once. Memory is what runs out, so this defaults to
 *    the one-at-a-time the main thread used to impose by blocking.
 *  - QUEUE WAIT. A download waiting longer than this for a build slot is
 *    refused with {@link MetricWorkbookBusyError}, which the route answers
 *    with a 503 before the frontend's own timeout gives up on it.
 *  - TIMEOUT. A build overrunning this has its worker terminated.
 *
 * The worker's old-generation heap is capped as well, so a build that runs
 * away ends its own worker, not the process.
 */

const WORKER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'workbook-worker.js'
)

/** Every build slot was taken for longer than the queue wait limit. */
export class MetricWorkbookBusyError extends Error {
  constructor(waitLimitMs) {
    super(`No metric workbook build slot came free within ${waitLimitMs} ms`)
    this.name = 'MetricWorkbookBusyError'
  }
}

/** A build overran its budget and its worker was terminated. */
export class MetricWorkbookTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Metric workbook build exceeded ${timeoutMs} ms`)
    this.name = 'MetricWorkbookTimeoutError'
  }
}

/** An error the worker reported, rebuilt with the worker's stack. */
function workerError({ message, stack }) {
  const error = new Error(message)
  error.stack = stack
  return error
}

/**
 * @typedef {object} BuilderOptions
 * @property {number} concurrency builds at once
 * @property {number} queueWaitLimitMs longest a build may wait for a slot
 * @property {number} timeoutMs budget for one build, start-up included
 * @property {number} maxHeapMb old-generation heap cap for each worker
 * @property {string|URL} [workerPath] worker module to run (test seam;
 *   defaults to the workbook worker)
 */

/**
 * @param {BuilderOptions} options
 */
export function createWorkbookBuilder({
  concurrency,
  queueWaitLimitMs,
  timeoutMs,
  maxHeapMb,
  workerPath = WORKER_PATH
}) {
  let running = 0
  /** Builds waiting for a slot, oldest first. */
  const waiting = []

  /** Take a build slot, waiting for one if all are taken. */
  function acquire() {
    if (running < concurrency) {
      running += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve }
      // Refused when the limit passes, not when a slot comes free, so a
      // refused download is answered at once rather than after the builds
      // ahead of it.
      entry.timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(entry), 1)
        reject(new MetricWorkbookBusyError(queueWaitLimitMs))
      }, queueWaitLimitMs)
      waiting.push(entry)
    })
  }

  /** Hand the slot to the oldest waiting build, or give it back. */
  function release() {
    const next = waiting.shift()
    if (next) {
      clearTimeout(next.timer)
      next.resolve()
      return
    }
    running -= 1
  }

  function runInWorker(message) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, {
        resourceLimits: { maxOldGenerationSizeMb: maxHeapMb }
      })
      let settled = false
      // The first outcome wins. Terminating the worker raises its `exit`,
      // which then finds the build already settled.
      const settle = (outcome, value) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        worker.terminate().catch(() => {
          // A worker that cannot be terminated has already exited.
        })
        outcome(value)
      }
      const timer = setTimeout(
        () => settle(reject, new MetricWorkbookTimeoutError(timeoutMs)),
        timeoutMs
      )

      worker.once('message', (reply) => {
        if (reply.error) {
          settle(reject, workerError(reply.error))
          return
        }
        const { bytes } = reply
        settle(
          resolve,
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        )
      })
      worker.once('error', (error) => settle(reject, error))
      worker.once('exit', (code) =>
        settle(
          reject,
          new Error(`Metric workbook worker exited with code ${code}`)
        )
      )
      worker.postMessage(message)
    })
  }

  return {
    /**
     * Build a workbook on a worker thread.
     *
     * @param {object} project the project document
     * @param {object} options
     * @param {'xlsm'|'xlsx'} options.format
     * @param {Date} [options.now] the date of the download
     * @returns {Promise<Buffer>} the workbook's bytes
     */
    async build(project, { format, now = new Date() }) {
      await acquire()
      try {
        return await runInWorker({ project, format, now })
      } finally {
        release()
      }
    },

    /** Builds running and waiting, for tests and logs. */
    stats() {
      return { running, waiting: waiting.length }
    }
  }
}

/** Process-wide builder, created on the first download. */
let builder = null

/**
 * Build a metric workbook on a worker thread, within the service's limits.
 *
 * @param {object} project the project document
 * @param {{ format: 'xlsm'|'xlsx', now?: Date }} options
 * @returns {Promise<Buffer>} the workbook's bytes
 */
export function buildMetricWorkbookInWorker(project, options) {
  builder ??= createWorkbookBuilder(config.get('metricWorkbook'))
  return builder.build(project, options)
}
