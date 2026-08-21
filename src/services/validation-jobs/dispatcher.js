import {
  claimNextJob,
  completeJob,
  deleteExpiredJobs,
  failExhaustedJobs,
  releaseOrFailJob,
  reapStaleJobs
} from './job-store.js'
import { runValidationJob } from './run-validation-job.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Pulls validation jobs off the table and runs them.
 *
 * Deliberately simple: there is one job type, and the work itself happens on a
 * worker thread. The dispatcher's only jobs are to claim work without racing
 * another instance, to hold no more than `maxConcurrentJobs` at once, and to
 * make sure nothing stays stuck.
 *
 * Because a claim is atomic (SELECT ... FOR UPDATE SKIP LOCKED), several
 * instances can run this concurrently against the same table with no
 * coordination between them.
 */
function createValidationJobDispatcher({ drizzle, pgPool, settings }) {
  // In-flight job promises, so shutdown can wait for them. A claimed job is
  // already marked `processing` in the table: abandoning it would strand the
  // row until the reaper's lease expires, minutes later, with the user still
  // polling. So once claimed, a job is always run to an outcome.
  const inFlight = new Set()
  let timer = null
  let stopped = false
  // Set while a sweep-and-drain pass is in flight, so overlapping nudges join
  // the pass already running instead of starting a second one.
  let pass = null

  async function runOneJob(job) {
    try {
      const { payload } = await runValidationJob({ drizzle, pgPool }, job)
      await completeJob(drizzle, job.id, payload)
      logger.info(`Validation job ${job.id} succeeded`)
    } catch (error) {
      // The job did not reach an answer. Hand it back for another attempt, or
      // bury it if it has used them all up. If even that write fails the job is
      // left in `processing` and the reaper will recover it, so the dispatcher
      // carries on rather than unwinding.
      await recordFailure(job, error)
    }
  }

  async function recordFailure(job, error) {
    try {
      const outcome = await releaseOrFailJob(
        drizzle,
        job.id,
        error.message,
        settings.maxAttempts
      )
      logger.error(
        `Validation job ${job.id} did not finish (attempt ${job.attempts}/${settings.maxAttempts}, now ${outcome?.status}): ${error.message}`
      )
    } catch (writeError) {
      logger.error(
        `Validation job ${job.id} failed (${error.message}) and the failure could not be recorded (${writeError.message}); leaving it for the reaper`
      )
    }
  }

  /** Claim and start jobs until we are full or the queue is empty. */
  async function drain() {
    while (inFlight.size < settings.maxConcurrentJobs) {
      if (stopped) {
        return
      }
      const job = await claimNextJob(drizzle, settings.maxAttempts)
      if (!job) {
        return
      }
      // Deliberately not awaited: the point is to have several in flight.
      // runOneJob records its own outcome and never rejects.
      const promise = runOneJob(job).finally(() => inFlight.delete(promise))
      inFlight.add(promise)
    }
  }

  /**
   * Recover jobs whose worker died, bury jobs out of attempts, and delete
   * finished ones past retention. Housekeeping failures must not stop the
   * dispatcher from picking up work, so each is reported and swallowed.
   */
  async function sweep() {
    try {
      const reaped = await reapStaleJobs(drizzle, settings.leaseMs)
      const buried = await failExhaustedJobs(drizzle, settings.maxAttempts)
      const deleted = await deleteExpiredJobs(drizzle, settings.retentionMs)
      if (reaped || buried || deleted) {
        logger.info(
          `Validation job sweep: ${reaped} reclaimed, ${buried} failed for good, ${deleted} deleted`
        )
      }
    } catch (error) {
      logger.error(`Validation job sweep failed: ${error.message}`)
    }
  }

  /**
   * One sweep-and-drain pass. Deliberately never rejects: several callers may
   * await the same pass, and a rejection would surface at whichever of them
   * happened to be second rather than at the cause.
   */
  function runPass() {
    return (async () => {
      try {
        await sweep()
        await drain()
      } catch (error) {
        logger.error(`Validation job dispatcher pass failed: ${error.message}`)
      } finally {
        pass = null
      }
    })()
  }

  async function tick() {
    if (stopped) {
      return
    }
    if (!pass) {
      pass = runPass()
    }
    await pass
  }

  return {
    start() {
      stopped = false
      timer = setInterval(tick, settings.pollIntervalMs)
      // Never hold the process open for the sake of the poll timer.
      timer.unref?.()
      logger.info(
        `Validation job dispatcher started (concurrency ${settings.maxConcurrentJobs}, poll ${settings.pollIntervalMs}ms)`
      )
      return tick()
    },

    /**
     * Look for work now rather than at the next tick. Called right after a job
     * is enqueued so an idle instance starts on it immediately.
     */
    nudge() {
      return tick()
    },

    async stop() {
      stopped = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      // Let anything mid-flight settle so its outcome is recorded rather than
      // left for the reaper to pick up minutes later. This waits on the pass
      // in progress, so stop() must be called from outside one — it is wired
      // to the server's 'stop' event, never from a job.
      await pass
      // runOneJob records its own outcome and never rejects, so waiting here
      // is what turns a redeploy from "jobs stranded for a lease" into
      // "jobs finished and answered".
      await Promise.all([...inFlight])
      logger.info('Validation job dispatcher stopped')
    },

    /** Exposed for tests and the health of the running instance. */
    get activeJobs() {
      return inFlight.size
    }
  }
}

export { createValidationJobDispatcher }
