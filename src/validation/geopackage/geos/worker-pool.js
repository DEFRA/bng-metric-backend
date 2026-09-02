/**
 * A small, fixed pool of worker threads running GEOS geometry validation.
 *
 * The pool cap IS the admission control, and that is the point of the whole
 * exercise. Geometry validation used to ration itself on database connections —
 * a shared resource the service cannot scale, so twelve concurrent validations
 * starved logins and page loads of connections for over a second each. Here the
 * rationed resource is CPU on the backend instance, which CDP can add more of.
 * Validation still queues under load; it just no longer queues behind, or in
 * front of, everything else the service does.
 *
 * Four properties the pool has to have, and none of them are optional:
 *
 *  - a FIXED, small size. WebAssembly linear memory grows to its high-water
 *    mark and is never returned, so each worker settles at a few hundred MB
 *    after a large file. Workers are a memory budget, not a throughput dial.
 *  - a BOUNDED queue. An unbounded one converts a traffic spike into a growing
 *    backlog of requests that have already timed out at the client.
 *  - a per-job TIMEOUT that kills the worker. A wedged GEOS call cannot be
 *    interrupted from JavaScript; the only way out is to terminate the thread.
 *  - RESTART on exit. A worker lost to a timeout, a crash or the WebAssembly
 *    heap running out must be replaced, or the pool silently shrinks to nothing.
 *
 * Every failure mode surfaces as a rejected promise, and the caller
 * (`validation/geopackage/index.js`) falls back to PostGIS. A bad day for this
 * pool is a slow upload, not a failed one.
 */
import { Worker } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger } from '../../../common/helpers/logging/logger.js'

const logger = createLogger()

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'worker.js')

/** Message type the worker answers — kept in step with worker.js. */
const VALIDATE = 'validate'

/**
 * Cores to leave for the main thread and everything else on the instance. One
 * is enough: the main thread is the only other CPU-bound consumer, and the
 * workers spend their time in GEOS rather than contending for it.
 */
const RESERVED_CORES = 1

/** Error thrown when the queue is full — the caller falls back to PostGIS. */
export class ValidationQueueFullError extends Error {
  constructor(limit) {
    super(`Geometry validation queue is full (${limit} waiting)`)
    this.name = 'ValidationQueueFullError'
  }
}

/**
 * Error thrown when a job waited longer than the pool's queue-wait limit before
 * a worker came free. Reported to the caller as busy, exactly like a full queue:
 * both mean "we did not look at your file, come back".
 */
export class ValidationQueueWaitError extends Error {
  constructor(waitedMs, limitMs) {
    super(`Waited ${waitedMs} ms for a validation worker (limit ${limitMs} ms)`)
    this.name = 'ValidationQueueWaitError'
  }
}

/** Error thrown when a job outlives its timeout and its worker was killed. */
export class ValidationTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Geometry validation exceeded ${timeoutMs} ms`)
    this.name = 'ValidationTimeoutError'
  }
}

/**
 * @typedef {object} PoolOptions
 * @property {number} size workers to run
 * @property {number} queueLimit jobs allowed to wait for a free worker
 * @property {number} timeoutMs per-job budget before the worker is killed
 * @property {number} queueWaitLimitMs longest a job may wait to START before it
 *   is refused instead
 */

export class GeosWorkerPool {
  /** @param {PoolOptions} options */
  constructor({ size, queueLimit, timeoutMs, queueWaitLimitMs = Infinity }) {
    // Never more workers than there are cores to run them on: oversubscribing
    // CPU-bound threads adds context switching and memory, and no throughput.
    this.size = Math.max(
      1,
      Math.min(size, availableParallelism() - RESERVED_CORES)
    )
    this.queueLimit = queueLimit
    this.timeoutMs = timeoutMs
    this.queueWaitLimitMs = queueWaitLimitMs
    this.nextJobId = 1
    /** Jobs waiting for a free worker. */
    this.queue = []
    /** @type {Set<object>} every live worker record. */
    this.workers = new Set()
    /** @type {object[]} the subset of `workers` with no job in flight. */
    this.idle = []
    this.closed = false
    this.geosVersion = null

    for (let i = 0; i < this.size; i++) {
      this.spawn()
    }
    logger.info(
      `geos worker pool started with ${this.size} worker(s), queue limit ${queueLimit}, ` +
        `job timeout ${timeoutMs} ms, queue wait limit ${queueWaitLimitMs} ms`
    )
  }

  /**
   * Would `run` accept a job right now?
   *
   * Exposed so a caller can ask BEFORE doing expensive preparation. The upload
   * route checks this before streaming the file out of S3: refusing after a
   * 100 MB download wastes the download, and a refusal has to be cheap for
   * clients to be able to retry it every few seconds.
   *
   * Advisory, not a reservation — the answer can be stale by the time `run` is
   * called, which is why `run` re-checks and can still refuse.
   */
  hasCapacity() {
    return (
      !this.closed &&
      (this.idle.length > 0 || this.queue.length < this.queueLimit)
    )
  }

  /** Start one worker and register its lifecycle handlers. */
  spawn() {
    const record = { worker: new Worker(WORKER_PATH), job: null, timer: null }
    record.worker.on('message', (message) => this.onMessage(record, message))
    record.worker.on('error', (error) => this.onExit(record, error))
    record.worker.on('exit', () => this.onExit(record, null))
    this.workers.add(record)
    return record
  }

  /**
   * A message from a worker: either its one-off readiness announcement, or the
   * result of the job it was given.
   */
  onMessage(record, message) {
    if (message?.ready) {
      this.geosVersion ??= message.geosVersion
      this.release(record)
      return
    }
    const job = record.job
    if (!job || job.id !== message?.jobId) {
      // A late reply from a job already timed out. Its worker is being
      // replaced, so there is nobody left to tell.
      return
    }
    this.finish(record)
    if (message.error) {
      const error = new Error(message.error.message)
      error.stack = message.error.stack
      job.reject(error)
    } else {
      job.resolve(message.result)
    }
    this.release(record)
  }

  /**
   * A worker died — crashed, ran out of WebAssembly heap, or was terminated by
   * this pool for overrunning. Fail whatever it was holding and replace it, so
   * the pool cannot quietly shrink to nothing over a long uptime.
   */
  onExit(record, error) {
    if (!this.workers.delete(record)) {
      return
    }
    this.idle = this.idle.filter((idle) => idle !== record)
    const job = record.job
    this.finish(record)
    if (job && !job.settled) {
      job.settled = true
      job.reject(error ?? new Error('Geometry validation worker exited'))
    }
    if (this.closed) {
      return
    }
    logger.warn(
      `geos validation worker exited${error ? `: ${error.message}` : ''} — replacing it`
    )
    this.release(this.spawn())
  }

  /** Clear a worker's in-flight job and its timeout. */
  finish(record) {
    clearTimeout(record.timer)
    record.timer = null
    record.job = null
  }

  /**
   * Mark a worker free, and immediately give it the next queued job.
   *
   * An IDLE worker is unref'd so it cannot hold the process open — a pool with
   * nothing to do should never be the reason a script or a test run refuses to
   * exit. A BUSY one is ref'd, so Node cannot exit part-way through a
   * validation. Ref state is owned here and in `dispatch`, and nowhere else.
   */
  release(record) {
    if (this.closed || !this.workers.has(record)) {
      return
    }
    const next = this.queue.shift()
    if (next) {
      this.dispatch(record, next)
    } else {
      this.idle.push(record)
      record.worker.unref()
    }
  }

  /**
   * Hand one job to one worker, and start its clock.
   *
   * A job that has been queued longer than `queueWaitLimitMs` is refused here
   * rather than started. By this point the caller has very likely given up — and
   * without this the worst-case wait is `queueLimit x timeoutMs`, which can far
   * exceed any client's patience. Refusing lets the client retry into a pool
   * that is actually free, instead of receiving work nobody is waiting for.
   */
  dispatch(record, job) {
    const waited = Date.now() - job.enqueuedAt
    if (waited > this.queueWaitLimitMs) {
      job.settled = true
      job.reject(new ValidationQueueWaitError(waited, this.queueWaitLimitMs))
      this.release(record)
      return
    }
    record.job = job
    record.worker.ref()
    record.timer = setTimeout(() => this.onTimeout(record, job), this.timeoutMs)
    record.worker.postMessage({
      type: VALIDATE,
      jobId: job.id,
      filePath: job.filePath,
      includeSizes: job.includeSizes
    })
  }

  /**
   * A job overran. GEOS cannot be interrupted from JavaScript, so the thread
   * itself has to go; `onExit` then rejects the job and replaces the worker.
   */
  onTimeout(record, job) {
    if (record.job !== job || job.settled) {
      return
    }
    job.settled = true
    job.reject(new ValidationTimeoutError(this.timeoutMs))
    logger.error(
      `geos validation exceeded ${this.timeoutMs} ms for ${job.filePath} — terminating the worker`
    )
    record.worker.terminate()
  }

  /**
   * Validate a GeoPackage on a worker thread.
   *
   * @param {string} filePath the uploaded file, already on local disk
   * @param {{ includeSizes?: boolean }} [options]
   * @returns {Promise<object>} the verdict from validateGeoPackageLayersGeos
   */
  run(filePath, { includeSizes = false } = {}) {
    if (this.closed) {
      return Promise.reject(new Error('Geometry validation pool is closed'))
    }
    if (this.idle.length === 0 && this.queue.length >= this.queueLimit) {
      return Promise.reject(new ValidationQueueFullError(this.queueLimit))
    }
    return new Promise((resolve, reject) => {
      const job = {
        id: this.nextJobId++,
        filePath,
        includeSizes,
        enqueuedAt: Date.now(),
        settled: false,
        resolve: (value) => {
          job.settled = true
          resolve(value)
        },
        reject
      }
      const worker = this.idle.pop()
      if (worker) {
        this.dispatch(worker, job)
      } else {
        this.queue.push(job)
      }
    })
  }

  /** How much work the pool is holding — for the health endpoint and logs. */
  stats() {
    return {
      size: this.workers.size,
      idle: this.idle.length,
      queued: this.queue.length,
      geosVersion: this.geosVersion
    }
  }

  /** Stop every worker and fail anything still waiting. Idempotent. */
  async close() {
    this.closed = true
    for (const job of this.queue.splice(0)) {
      job.reject(new Error('Geometry validation pool is closing'))
    }
    await Promise.all(
      [...this.workers].map((record) => {
        this.finish(record)
        return record.worker.terminate()
      })
    )
    this.workers.clear()
    this.idle = []
  }
}

/** Process-wide pool, created on first use. @type {GeosWorkerPool | null} */
let pool = null

/**
 * The shared pool, started on the first validation rather than at boot: a
 * service running the PostGIS engine should not pay for workers it never uses.
 *
 * @param {PoolOptions} options
 * @returns {GeosWorkerPool}
 */
export function getGeosWorkerPool(options) {
  pool ??= new GeosWorkerPool(options)
  return pool
}

/** Shut the shared pool down — called from the server's stop hook. */
export async function closeGeosWorkerPool() {
  if (pool) {
    const closing = pool.close()
    pool = null
    await closing
  }
}
