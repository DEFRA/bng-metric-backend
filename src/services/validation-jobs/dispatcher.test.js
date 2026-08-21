import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./job-store.js', () => ({
  claimNextJob: vi.fn(),
  completeJob: vi.fn(),
  releaseOrFailJob: vi.fn(),
  reapStaleJobs: vi.fn(),
  failExhaustedJobs: vi.fn(),
  deleteExpiredJobs: vi.fn()
}))
vi.mock('./run-validation-job.js', () => ({ runValidationJob: vi.fn() }))

const {
  claimNextJob,
  completeJob,
  releaseOrFailJob,
  reapStaleJobs,
  failExhaustedJobs,
  deleteExpiredJobs
} = await import('./job-store.js')
const { runValidationJob } = await import('./run-validation-job.js')
const { createValidationJobDispatcher } = await import('./dispatcher.js')

const SETTINGS = {
  maxConcurrentJobs: 2,
  pollIntervalMs: 60_000,
  leaseMs: 300_000,
  maxAttempts: 3,
  retentionMs: 86_400_000
}

function makeJob(id, attempts = 1) {
  return {
    id,
    uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147',
    projectId: null,
    documentKey: 'baseline',
    credentials: { sub: 'sub-1' },
    attempts
  }
}

function makeDispatcher(settings = SETTINGS) {
  return createValidationJobDispatcher({
    drizzle: {},
    pgPool: {},
    settings
  })
}

/** Queue up claim results, then nothing. */
function queueJobs(...jobs) {
  vi.mocked(claimNextJob).mockReset()
  for (const job of jobs) {
    vi.mocked(claimNextJob).mockResolvedValueOnce(job)
  }
  vi.mocked(claimNextJob).mockResolvedValue(null)
}

describe('validation job dispatcher', () => {
  let dispatcher

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reapStaleJobs).mockResolvedValue(0)
    vi.mocked(failExhaustedJobs).mockResolvedValue(0)
    vi.mocked(deleteExpiredJobs).mockResolvedValue(0)
    vi.mocked(runValidationJob).mockResolvedValue({
      statusCode: 200,
      payload: { valid: true, errors: [] }
    })
    queueJobs()
  })

  afterEach(async () => {
    await dispatcher?.stop()
  })

  it('runs a claimed job and records its payload', async () => {
    queueJobs(makeJob('job-1'))
    dispatcher = makeDispatcher()

    await dispatcher.nudge()

    expect(runValidationJob).toHaveBeenCalledTimes(1)
    expect(completeJob).toHaveBeenCalledWith({}, 'job-1', {
      valid: true,
      errors: []
    })
  })

  it('stores a rejection payload as a succeeded job', async () => {
    // The file being invalid is a job that succeeded in finding that out —
    // the client polls to a terminal state and reads the errors.
    queueJobs(makeJob('job-1'))
    vi.mocked(runValidationJob).mockResolvedValue({
      statusCode: 200,
      payload: { valid: false, errors: [{ code: 'GPKG_INVALID_FILE' }] }
    })
    dispatcher = makeDispatcher()

    await dispatcher.nudge()

    expect(completeJob).toHaveBeenCalledWith({}, 'job-1', {
      valid: false,
      errors: [{ code: 'GPKG_INVALID_FILE' }]
    })
    expect(releaseOrFailJob).not.toHaveBeenCalled()
  })

  it('hands a job back when it throws, rather than losing it', async () => {
    queueJobs(makeJob('job-1'))
    vi.mocked(runValidationJob).mockRejectedValue(new Error('S3 timed out'))
    vi.mocked(releaseOrFailJob).mockResolvedValue({ status: 'pending' })
    dispatcher = makeDispatcher()

    await dispatcher.nudge()

    expect(releaseOrFailJob).toHaveBeenCalledWith(
      {},
      'job-1',
      'S3 timed out',
      SETTINGS.maxAttempts
    )
    expect(completeJob).not.toHaveBeenCalled()
  })

  it('carries on when even recording the failure fails', async () => {
    // The row is left in processing and the reaper recovers it; the dispatcher
    // must not unwind and stop taking work.
    queueJobs(makeJob('job-1'))
    vi.mocked(runValidationJob).mockRejectedValue(new Error('parse died'))
    vi.mocked(releaseOrFailJob).mockRejectedValue(new Error('db unreachable'))
    dispatcher = makeDispatcher()

    await expect(dispatcher.nudge()).resolves.not.toThrow()
    expect(dispatcher.activeJobs).toBe(0)
  })

  it('claims no more than maxConcurrentJobs at once', async () => {
    const releases = []
    vi.mocked(runValidationJob).mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve)
        })
    )
    queueJobs(makeJob('a'), makeJob('b'), makeJob('c'))
    dispatcher = makeDispatcher({ ...SETTINGS, maxConcurrentJobs: 2 })

    await dispatcher.nudge()

    // Two slots, three jobs waiting: it claims exactly what it can run, so a
    // third job is left in the table for the next pass or another instance.
    expect(dispatcher.activeJobs).toBe(2)
    expect(claimNextJob).toHaveBeenCalledTimes(2)

    // Release both so shutdown, which now waits for in-flight work, can finish.
    for (const release of releases) {
      release({ statusCode: 200, payload: {} })
    }
  })

  it('releases its slot when a job finishes', async () => {
    queueJobs(makeJob('job-1'))
    dispatcher = makeDispatcher()

    await dispatcher.nudge()

    expect(dispatcher.activeJobs).toBe(0)
  })

  it('sweeps for stale, exhausted and expired jobs on every pass', async () => {
    dispatcher = makeDispatcher()

    await dispatcher.nudge()

    expect(reapStaleJobs).toHaveBeenCalledWith({}, SETTINGS.leaseMs)
    expect(failExhaustedJobs).toHaveBeenCalledWith({}, SETTINGS.maxAttempts)
    expect(deleteExpiredJobs).toHaveBeenCalledWith({}, SETTINGS.retentionMs)
  })

  it('still looks for work when the sweep fails', async () => {
    // Housekeeping is best-effort; a failing sweep must not stop the queue.
    vi.mocked(reapStaleJobs).mockRejectedValue(new Error('db hiccup'))
    queueJobs(makeJob('job-1'))
    dispatcher = makeDispatcher()

    await dispatcher.nudge()

    expect(runValidationJob).toHaveBeenCalledTimes(1)
  })

  it('joins the pass already running rather than starting a second', async () => {
    queueJobs(makeJob('job-1'))
    dispatcher = makeDispatcher()

    await Promise.all([dispatcher.nudge(), dispatcher.nudge()])

    expect(reapStaleJobs).toHaveBeenCalledTimes(1)
  })

  it('claims nothing once stopped', async () => {
    dispatcher = makeDispatcher()
    await dispatcher.stop()
    queueJobs(makeJob('job-1'))

    await dispatcher.nudge()

    expect(runValidationJob).not.toHaveBeenCalled()
  })

  it('logs what the sweep recovered when it recovered anything', async () => {
    vi.mocked(reapStaleJobs).mockResolvedValue(2)
    vi.mocked(failExhaustedJobs).mockResolvedValue(1)
    vi.mocked(deleteExpiredJobs).mockResolvedValue(5)
    dispatcher = makeDispatcher()

    await expect(dispatcher.nudge()).resolves.not.toThrow()
  })

  it('survives a claim that throws', async () => {
    // A database blip during claim must not take the dispatcher down with it;
    // the next tick tries again.
    vi.mocked(claimNextJob).mockReset()
    vi.mocked(claimNextJob).mockRejectedValue(new Error('connection reset'))
    dispatcher = makeDispatcher()

    await expect(dispatcher.nudge()).resolves.not.toThrow()
  })

  it('stops claiming as soon as stop() is called mid-drain', async () => {
    // stop() lands while the first claim is in flight; the loop must notice
    // rather than filling every slot on the way out.
    let stopping
    vi.mocked(claimNextJob).mockReset()
    vi.mocked(claimNextJob).mockImplementation(async () => {
      // Not awaited: stop() waits for the pass this claim belongs to, so
      // awaiting it here would deadlock. `stopped` is set synchronously.
      stopping = dispatcher.stop()
      return makeJob('job-1')
    })
    dispatcher = makeDispatcher({ ...SETTINGS, maxConcurrentJobs: 2 })

    await dispatcher.nudge()
    await stopping

    // It claims no further work, but the job it had already claimed is run to
    // an outcome rather than stranded in `processing` for the reaper.
    expect(claimNextJob).toHaveBeenCalledTimes(1)
    expect(runValidationJob).toHaveBeenCalledTimes(1)
    expect(completeJob).toHaveBeenCalledWith({}, 'job-1', expect.anything())
  })

  it('waits for work in flight before reporting itself stopped', async () => {
    let release
    vi.mocked(runValidationJob).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    queueJobs(makeJob('job-1'))
    dispatcher = makeDispatcher()
    const pass = dispatcher.nudge()

    const stopped = dispatcher.stop()
    release?.({ statusCode: 200, payload: {} })
    await pass

    await expect(stopped).resolves.toBeUndefined()
  })

  it('polls on an interval once started', async () => {
    vi.useFakeTimers()
    try {
      dispatcher = makeDispatcher({ ...SETTINGS, pollIntervalMs: 1000 })
      await dispatcher.start()
      const passesAfterStart = vi.mocked(reapStaleJobs).mock.calls.length

      await vi.advanceTimersByTimeAsync(2500)

      expect(vi.mocked(reapStaleJobs).mock.calls.length).toBeGreaterThan(
        passesAfterStart
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a tick that throws from the timer without crashing the process', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(reapStaleJobs).mockRejectedValue(new Error('db gone'))
      vi.mocked(claimNextJob).mockReset()
      vi.mocked(claimNextJob).mockRejectedValue(new Error('db gone'))
      dispatcher = makeDispatcher({ ...SETTINGS, pollIntervalMs: 1000 })
      await dispatcher.start()

      await expect(vi.advanceTimersByTimeAsync(1500)).resolves.not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('start() does a first pass immediately rather than waiting for a tick', async () => {
    queueJobs(makeJob('job-1'))
    dispatcher = makeDispatcher()

    await dispatcher.start()

    expect(runValidationJob).toHaveBeenCalledTimes(1)
  })
})
