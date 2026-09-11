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
 * Every failure mode surfaces as a rejected promise. There is no fallback
 * engine: a full queue or busy pool surfaces to the client as a retryable
 * busy response, and any other failure fails the validation outright — the
 * same file must never get a different answer depending on how busy the box
 * was.
 */
import { Worker } from 'node:worker_threads'
import { availableParallelism, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger } from '../../../common/helpers/logging/logger.js'
import { metricsCounter } from '../../../common/helpers/metrics.js'
import { VALIDATION_METRIC } from '../../../common/helpers/metric-names.js'

const logger = createLogger()

/**
 * Count an event without making the caller wait for the flush.
 *
 * The pool's lifecycle hooks are synchronous — a worker dies, a timer fires —
 * and metric emission is async. `withMetrics` already swallows its own failures,
 * so the only thing left to handle is the floating promise.
 */
function count(name) {
  metricsCounter(name).catch(() => {
    // Unreachable: withMetrics never rejects. Here so a future change to that
    // contract cannot turn a metric into an unhandled rejection.
  })
}

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'worker.js')

/** Message type the worker answers — kept in step with worker.js. */
const VALIDATE = 'validate'

/**
 * Cores to leave for the main thread and everything else on the instance. One
 * is enough: the main thread is the only other CPU-bound consumer, and the
 * workers spend their time in GEOS rather than contending for it.
 */
const RESERVED_CORES = 1

const BYTES_PER_MB = 1024 * 1024

/**
 * Steady-state footprint of one worker, measured on a 5,000-parcel file.
 *
 * WebAssembly linear memory grows to the high-water mark of the largest file a
 * worker has ever seen and is never handed back, so this is a permanent cost
 * per worker rather than a peak — and it is charged against the SAME container
 * limit as the server, because workers are threads in this process.
 */
const WORKER_RSS_MB = 250
const WORKER_RSS_BYTES = WORKER_RSS_MB * BYTES_PER_MB

/**
 * Share of the task's memory the worker heaps may claim.
 *
 * What the rest pays for is not slack: Node's own baseline, the parse budget's
 * files being unpacked, and one worker's working copy of the largest file in
 * flight. Calibrated against the sizing docs/geometry-validation.md already
 * gives by hand — one worker at a 1 GB task, two at 2 GB — so auto-sizing lands
 * where the written guidance did rather than inventing a second answer.
 */
const WORKER_MEMORY_SHARE = 0.3

/** `size` at or below this means "work it out from the instance". */
const AUTO_SIZE = 0

/**
 * How much memory this process is actually allowed.
 *
 * `constrainedMemory()` reads the cgroup limit, which is the number that
 * matters in a container and the one the OOM killer enforces — `totalmem()`
 * reports the HOST's RAM and would happily size a pool for 64 GB the task
 * cannot touch. It answers 0 when there is no limit or it cannot tell, which is
 * the one case where the host figure is the honest answer.
 *
 * On Fargate the fallback is not a downgrade: each task is a microVM sized to
 * the task definition, so the host IS the task. It matters on anything sharing
 * a kernel — a dev box, a CI runner, ECS on EC2.
 */
function taskMemoryBytes() {
  return process.constrainedMemory() || totalmem()
}

/**
 * Decide how many workers to run, from what was asked for and what the instance
 * can actually carry.
 *
 * Two budgets, and the smaller wins. CPU, because oversubscribing CPU-bound
 * threads adds context switching and no throughput. MEMORY, because a worker is
 * a quarter-gigabyte that is never given back, and a pool sized past the task
 * limit does not run slowly — it is OOM-killed, taking every in-flight upload
 * with it.
 *
 * Both budgets apply to an explicit `VALIDATION_WORKER_COUNT` too, not just to
 * the automatic default. A number an operator typed is a request, not a
 * guarantee the box can honour it, and the CPU budget has always been enforced
 * this way.
 *
 * @param {number} requested workers asked for, or `AUTO_SIZE` to derive it
 * @returns {{ size: number, cpuBudget: number, memoryBudget: number, auto: boolean }}
 */
export function resolveWorkerCount(requested) {
  const cpuBudget = Math.max(1, availableParallelism() - RESERVED_CORES)
  const memoryBudget = Math.max(
    1,
    Math.floor((taskMemoryBytes() * WORKER_MEMORY_SHARE) / WORKER_RSS_BYTES)
  )
  // The finite check carries its weight: a bare `requested <= AUTO_SIZE` is
  // FALSE for a NaN — a malformed environment variable — which would pin the
  // pool to no workers at all. Anything not a real number auto-sizes instead.
  const auto = !Number.isFinite(requested) || requested <= AUTO_SIZE
  const wanted = auto ? cpuBudget : requested
  return {
    size: Math.min(wanted, cpuBudget, memoryBudget),
    cpuBudget,
    memoryBudget,
    auto
  }
}

/**
 * Say how the pool was sized and which budget decided it.
 *
 * This is the line that answers the rollout's open question — whether
 * `availableParallelism()` reports the task's CPU quota or the host's cores,
 * which is not knowable from outside the container and changes what the right
 * instance size is. Being bound by MEMORY is warned rather than logged: it means
 * the task cannot carry the CPU it has been given, which is a provisioning
 * mistake worth seeing without going looking.
 *
 * Exported so the memory-bound branch can be asserted without standing up a
 * pool: the only way to reach it through the constructor is to spawn real
 * worker threads, which is a different suite and a far heavier way to check
 * which way round a log line goes.
 */
export function logSizing(size, { cpuBudget, memoryBudget, auto }) {
  const taskMemoryMb = Math.round(taskMemoryBytes() / BYTES_PER_MB)
  const detail =
    `${auto ? 'auto-sized' : 'requested'} — cpu budget ${cpuBudget} ` +
    `(availableParallelism ${availableParallelism()} less ${RESERVED_CORES} reserved), ` +
    `memory budget ${memoryBudget} (${taskMemoryMb} MB task memory)`
  if (memoryBudget < cpuBudget) {
    logger.warn(
      `geos worker pool limited to ${size} worker(s) by MEMORY, not cpu: ${detail}. ` +
        'Raise the task memory limit to use the cores this instance has.'
    )
    return
  }
  logger.info(`geos worker pool sized to ${size} worker(s): ${detail}`)
}

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

/**
 * Error thrown when a job outlives its timeout and its worker was killed.
 *
 * Carries what the pool looked like at the moment it fired, because that is the
 * only evidence available for the question the route has to answer: was this
 * file too slow, or was the box too busy to finish it? Nobody downstream can
 * reconstruct it — by the time the rejection is handled the pool has moved on —
 * so it is stamped here.
 */
export class ValidationTimeoutError extends Error {
  /**
   * @param {number} timeoutMs the budget that was overrun
   * @param {{ queueDepth: number, busyWorkers: number }} pressure pool state
   *   when the timer fired. `busyWorkers` counts the timed-out job's own worker,
   *   so anything above one means it was sharing the machine.
   */
  constructor(timeoutMs, pressure = { queueDepth: 0, busyWorkers: 1 }) {
    super(`Geometry validation exceeded ${timeoutMs} ms`)
    this.name = 'ValidationTimeoutError'
    this.queueDepth = pressure.queueDepth
    this.busyWorkers = pressure.busyWorkers
  }

  /**
   * Was anything else competing for the machine while this job ran?
   *
   * A job that overran with the pool otherwise EMPTY had the box to itself, so
   * the budget is the ceiling for this file and a retry would only reproduce the
   * failure. A job that overran alongside other work may well pass once the pool
   * drains, and is the case worth retrying. The two need different answers to
   * the user, which is the whole reason this is recorded.
   */
  get contended() {
    return this.queueDepth > 0 || this.busyWorkers > 1
  }
}

/**
 * @typedef {object} PoolOptions
 * @property {number} size workers to run
 * @property {number} queueLimit jobs allowed to wait for a free worker
 * @property {number} timeoutMs per-job budget before the worker is killed
 * @property {number} queueWaitLimitMs longest a job may wait to START before it
 *   is refused instead
 * @property {number} [admissionLimit] requests allowed in flight at once, from
 *   admission through to response. Bounds I/O rather than CPU, so it is a much
 *   larger number than `queueLimit`. Unbounded when omitted.
 */

export class GeosWorkerPool {
  /** @param {PoolOptions} options */
  constructor({
    size,
    queueLimit,
    timeoutMs,
    queueWaitLimitMs = Infinity,
    admissionLimit = Infinity
  }) {
    const sizing = resolveWorkerCount(size)
    this.size = sizing.size
    this.queueLimit = queueLimit
    this.timeoutMs = timeoutMs
    this.queueWaitLimitMs = queueWaitLimitMs
    this.admissionLimit = admissionLimit
    /** Requests admitted and not yet finished. See {@link admit}. */
    this.admitted = 0
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
    logSizing(this.size, sizing)
    logger.info(
      `geos worker pool started with ${this.size} worker(s), queue limit ${queueLimit}, ` +
        `job timeout ${timeoutMs} ms, queue wait limit ${queueWaitLimitMs} ms, ` +
        `admission limit ${admissionLimit}`
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

  /**
   * Take a place in the service, before the file is fetched from S3.
   *
   * Use this rather than {@link hasCapacity} to decide whether to accept a
   * request. `hasCapacity` only asks a question, so when many requests arrive
   * together they all ask before any of them has taken a place, they are all
   * told yes, and they all download a file that most of them will then be
   * refused for. Taking a place first is what stops that: the count goes up
   * before the caller is told yes, so the tenth arrival sees the first nine.
   *
   * The limit here counts requests being handled at all, from arrival to
   * response — mostly time spent downloading. That is a different thing from
   * `queueLimit`, which counts requests waiting for a worker, so this number
   * is much larger. Setting it as low as `queueLimit` would refuse bursts the
   * service handles fine.
   *
   * @returns {(() => void)|null} call it to give the place back, or null if
   *   the service is already full. Calling it twice is harmless.
   */
  admit() {
    if (this.closed || this.admitted >= this.admissionLimit) {
      return null
    }
    this.admitted += 1
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.admitted -= 1
    }
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
      // The wait is the caller's to record: only the pool knows it, and it is
      // the number that separates "too few workers" from "too much geometry".
      job.resolve({ ...message.result, queueWaitMs: job.queueWaitMs })
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
    const cause = error ? `: ${error.message}` : ''
    logger.warn(`geos validation worker exited${cause} — replacing it`)
    count(VALIDATION_METRIC.workerRestarts)
    // Spawn only. The replacement releases ITSELF when it posts `ready`, the
    // same way the workers built in the constructor do — releasing it here as
    // well put one worker into `idle` twice, and two concurrent validations
    // could then be handed to the same thread. Waiting for `ready` also stops a
    // job spending part of its timeout budget on the WebAssembly compile.
    this.spawn()
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
    if (record.job || this.idle.includes(record)) {
      // Already busy, or already free. Either way this call would double-count
      // the worker; the version of this bug that shipped as a double release
      // ended with a job that never settled at all.
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
    if (record.job) {
      // Unreachable while `release` and `run` are the only callers, and fatal if
      // it ever stops being: overwriting `record.job` orphans the job that was
      // there, whose timer no longer matches and so never fires. Its caller
      // waits for a promise nothing will ever settle.
      this.queue.unshift(job)
      logger.error(
        'geos validation dispatch to a busy worker — requeued rather than dropping the job in flight'
      )
      return
    }
    const waited = Date.now() - job.enqueuedAt
    if (waited > this.queueWaitLimitMs) {
      job.settled = true
      job.reject(new ValidationQueueWaitError(waited, this.queueWaitLimitMs))
      this.release(record)
      return
    }
    job.queueWaitMs = waited
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
    // Read before terminating: `onExit` empties the record, and the whole point
    // of these two numbers is what the pool looked like WHILE the job ran.
    const pressure = {
      queueDepth: this.queue.length,
      busyWorkers: this.workers.size - this.idle.length
    }
    job.reject(new ValidationTimeoutError(this.timeoutMs, pressure))
    logger.error(
      `geos validation exceeded ${this.timeoutMs} ms for ${job.filePath} — terminating the worker ` +
        `(queue depth ${pressure.queueDepth}, ${pressure.busyWorkers} of ${this.size} workers busy)`
    )
    count(VALIDATION_METRIC.workerTimeouts)
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
    // Read then advance, rather than `this.nextJobId++`: the rule is about
    // consuming the operator's value, which hoisting it out of the object
    // literal did not stop.
    const id = this.nextJobId
    this.nextJobId += 1
    return new Promise((resolve, reject) => {
      const job = {
        id,
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
      admitted: this.admitted,
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
