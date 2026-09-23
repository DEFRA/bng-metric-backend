import { availableParallelism } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import {
  GeosWorkerPool,
  ValidationQueueFullError,
  ValidationQueueWaitError,
  ValidationTimeoutError,
  ValidationUnavailableError,
  closeGeosWorkerPool,
  getGeosWorkerPool
} from './worker-pool.js'

/**
 * These tests drive real worker threads, because the properties worth asserting
 * — that a wedged job's worker is killed and replaced, that a full queue is
 * refused rather than grown — only exist across a real thread boundary.
 *
 * No valid GeoPackage is needed: a path that does not exist makes the worker
 * fail in a well-defined way, which is exactly the plumbing under test. The
 * happy path is covered by the parity suite in integration-tests/.
 */

const MISSING_FILE = '/nonexistent/not-a-real-upload.gpkg'
const TIMEOUT_TEST_DEADLINE_MS = 100
const TIMEOUT_WORKER = new URL(
  './worker-pool.timeout-test-worker.js',
  import.meta.url
)
const GENEROUS_TIMEOUT_MS = 30_000

/** Polling interval and deadline for "has the replacement announced itself yet". */
const POLL_INTERVAL_MS = 25
const READY_DEADLINE_MS = 15_000

/**
 * How long a job gets to settle before the test calls it hung, and the budget
 * the two worker-replacement tests run under. The deadline sits well inside the
 * budget so a hung job fails on the assertion — which names what went wrong —
 * rather than on vitest's own timeout, which does not.
 */
const SETTLE_DEADLINE_MS = 8000
const REPLACEMENT_TEST_TIMEOUT_MS = 20_000

/** Budget for the test that boots three replacement workers back to back. */
const LONG_REPLACEMENT_TEST_TIMEOUT_MS = 45_000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolve once the pool has a free worker, or give up and let the test assert. */
async function waitForIdleWorker(pool) {
  const deadline = Date.now() + READY_DEADLINE_MS
  while (pool.stats().idle === 0 && Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS)
  }
}

/**
 * 'settled' if the promise finishes either way, 'hung' if it does neither.
 *
 * A job that never settles is the failure being guarded against, and it does
 * not throw — it simply never comes back — so the test has to put a clock on it
 * rather than await it.
 */
function settlesWithin(promise) {
  return Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled'
    ),
    delay(SETTLE_DEADLINE_MS).then(() => 'hung')
  ])
}

/** Pools opened by a test, closed afterwards whatever the test did. */
const opened = []

function openPool(options) {
  const pool = new GeosWorkerPool({
    size: 1,
    queueLimit: 4,
    timeoutMs: GENEROUS_TIMEOUT_MS,
    ...options
  })
  opened.push(pool)
  return pool
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((pool) => pool.close()))
  await closeGeosWorkerPool()
})

describe('GeosWorkerPool', () => {
  it('never starts more workers than there are cores to run them on', () => {
    expect(openPool({ size: 1000 }).size).toBeLessThanOrEqual(
      Math.max(1, availableParallelism() - 1)
    )
  })

  it('always starts a usable pool, however nonsensical the setting', () => {
    // Not `toBe(1)`: a non-positive setting auto-sizes, so the answer depends
    // on the machine the suite is running on. The floor itself is asserted
    // deterministically in worker-pool-sizing.test.js.
    expect(openPool({ size: -1 }).size).toBeGreaterThanOrEqual(1)
  })

  it('auto-sizes from the instance when the setting is 0, which is the default', () => {
    // One pool, not one per assertion: auto-sizing on a many-core runner spawns
    // a worker per core, and each one loads its own copy of GEOS.
    // The budgets themselves are covered in worker-pool-sizing.test.js, where
    // the machine can be described rather than taken as found.
    const { size } = openPool({ size: 0 })
    expect(size).toBeGreaterThanOrEqual(1)
    expect(size).toBeLessThanOrEqual(Math.max(1, availableParallelism() - 1))
  })

  it('surfaces a worker-side failure as a rejected promise, not a crash', async () => {
    const pool = openPool()
    await expect(pool.run(MISSING_FILE)).rejects.toThrow()
  })

  it('stays usable after a job fails', async () => {
    const pool = openPool()
    await expect(pool.run(MISSING_FILE)).rejects.toThrow()
    await expect(pool.run(MISSING_FILE)).rejects.toThrow()
    expect(pool.stats().size).toBe(pool.size)
  })

  it('refuses work once the queue is full rather than growing it', async () => {
    const pool = openPool({ size: 1, queueLimit: 1 })
    const outcomes = await Promise.allSettled([
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE)
    ])
    const refusals = outcomes.filter(
      (outcome) => outcome.reason instanceof ValidationQueueFullError
    )
    expect(refusals.length).toBeGreaterThan(0)
  })

  it('kills the worker on an overrun, and replaces it', async () => {
    // The fixture announces ready but deliberately never replies. Unlike a
    // missing GeoPackage (which can fail before a tiny timer fires), this makes
    // the overrun deterministic even when the full suite is under load.
    const pool = openPool({
      timeoutMs: TIMEOUT_TEST_DEADLINE_MS,
      workerPath: TIMEOUT_WORKER
    })
    await expect(pool.run(MISSING_FILE)).rejects.toBeInstanceOf(
      ValidationTimeoutError
    )
    // The replacement announces itself asynchronously. Wait for it to become
    // usable before asserting the pool has regained its configured capacity;
    // checking immediately races the worker thread under full-suite load.
    await waitForIdleWorker(pool)
    expect(pool.stats().size).toBe(pool.size)
    expect(pool.stats().idle).toBe(1)
  })

  // A replaced worker used to be released twice — once by `onExit`, once by its
  // own `ready` message — so a single thread sat in `idle` under two entries.
  // Two concurrent validations were then handed to the same worker, the second
  // overwriting the first's job and timer. The first promise never settled at
  // all: no result, no timeout, no rejection. Its request hung until the client
  // gave up, holding the temp file and the parsed layers the whole time.
  it(
    'releases a replaced worker once, not twice',
    async () => {
      const pool = openPool()
      await waitForIdleWorker(pool)

      const [victim] = [...pool.workers]
      await victim.worker.terminate()
      await waitForIdleWorker(pool)

      // Running a job through the replacement is what makes this deterministic:
      // a worker posts `ready` before it posts any result, so by the time this
      // resolves every release that was going to happen has happened. Polling
      // the idle count alone races the `ready` message and passes either way.
      await pool.run(MISSING_FILE).catch(() => {})

      expect(pool.stats().size).toBe(pool.size)
      expect(pool.stats().idle).toBe(1)
    },
    REPLACEMENT_TEST_TIMEOUT_MS
  )

  it(
    'settles every job after a worker has been replaced',
    async () => {
      const pool = openPool()
      await waitForIdleWorker(pool)

      const [victim] = [...pool.workers]
      await victim.worker.terminate()
      await waitForIdleWorker(pool)

      // Two at once, because one alone cannot collide with anything.
      await expect(
        Promise.all([
          settlesWithin(pool.run(MISSING_FILE)),
          settlesWithin(pool.run(MISSING_FILE))
        ])
      ).resolves.toEqual(['settled', 'settled'])
    },
    REPLACEMENT_TEST_TIMEOUT_MS
  )

  it('reports the GEOS version its workers are running', async () => {
    const pool = openPool()
    await pool.run(MISSING_FILE).catch(() => {})
    expect(pool.stats().geosVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('fails queued work when it closes, rather than hanging the caller', async () => {
    const pool = openPool({ size: 1, queueLimit: 10 })
    // Settle-watching must be attached before close(), which rejects queued
    // work synchronously.
    const outcomes = Promise.allSettled([
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE)
    ])
    await pool.close()
    expect(
      (await outcomes).every((outcome) => outcome.status === 'rejected')
    ).toBe(true)
  })

  it('refuses new work once closed', async () => {
    const pool = openPool()
    await pool.close()
    await expect(pool.run(MISSING_FILE)).rejects.toThrow(/closed/)
  })
})

describe('GeosWorkerPool — capacity, checked before the caller does any work', () => {
  it('reports capacity while the queue has room', () => {
    expect(openPool({ size: 1, queueLimit: 4 }).hasCapacity()).toBe(true)
  })

  it('reports none once the queue is full', async () => {
    const pool = openPool({ size: 1, queueLimit: 1 })
    const jobs = Promise.allSettled([
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE)
    ])
    // Both are in flight or queued, so a third would be refused.
    expect(pool.hasCapacity()).toBe(false)
    await jobs
  })

  it('reports none once closed', async () => {
    const pool = openPool()
    await pool.close()
    expect(pool.hasCapacity()).toBe(false)
  })

  it('agrees with what run() actually does', async () => {
    const pool = openPool({ size: 1, queueLimit: 1 })
    const jobs = Promise.allSettled([
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE)
    ])
    expect(pool.hasCapacity()).toBe(false)
    await expect(pool.run(MISSING_FILE)).rejects.toBeInstanceOf(
      ValidationQueueFullError
    )
    await jobs
  })
})

describe('GeosWorkerPool — admission, reserved before the caller does any work', () => {
  it('hands out places up to the limit and then refuses', () => {
    const pool = openPool({ admissionLimit: 2 })
    expect(pool.admit()).toBeInstanceOf(Function)
    expect(pool.admit()).toBeInstanceOf(Function)
    expect(pool.admit()).toBeNull()
  })

  it('cannot be raced the way hasCapacity() can', () => {
    // The point of the whole mechanism. Every caller of a synchronised burst
    // asks while the pool is still empty; hasCapacity() says yes to all of
    // them, admit() says yes to exactly `admissionLimit` of them.
    const pool = openPool({ admissionLimit: 3 })
    const burst = Array.from({ length: 10 }, () => ({
      capacity: pool.hasCapacity(),
      place: pool.admit()
    }))
    expect(burst.filter((r) => r.capacity)).toHaveLength(10)
    expect(burst.filter((r) => r.place)).toHaveLength(3)
  })

  it('gives the place back when released', () => {
    const pool = openPool({ admissionLimit: 1 })
    const release = pool.admit()
    expect(pool.admit()).toBeNull()
    release()
    expect(pool.admit()).toBeInstanceOf(Function)
  })

  it('releases once however many times it is called', () => {
    // The route releases in a `finally` that can run after an early return has
    // already released; double-counting here would leak capacity upwards.
    const pool = openPool({ admissionLimit: 1 })
    const release = pool.admit()
    release()
    release()
    release()
    expect(pool.admitted).toBe(0)
  })

  it('is unbounded when no limit is configured', () => {
    const pool = openPool()
    expect(Array.from({ length: 50 }, () => pool.admit()).every(Boolean)).toBe(
      true
    )
  })

  it('refuses once closed', async () => {
    const pool = openPool({ admissionLimit: 4 })
    await pool.close()
    expect(pool.admit()).toBeNull()
  })
})

describe('GeosWorkerPool — queue wait limit', () => {
  // Without this bound the worst case is queueLimit x timeoutMs, which is far
  // past any client's patience — and starting work nobody is waiting for helps
  // nobody.
  it('refuses a job that waited too long instead of starting it', async () => {
    const pool = openPool({ size: 1, queueLimit: 10, queueWaitLimitMs: 0 })
    const outcomes = await Promise.allSettled([
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE)
    ])
    const waited = outcomes.filter(
      (outcome) => outcome.reason instanceof ValidationQueueWaitError
    )
    expect(waited.length).toBeGreaterThan(0)
  })

  it('does not refuse work handed straight to an idle worker', async () => {
    const pool = openPool({ size: 1, queueLimit: 10, queueWaitLimitMs: 0 })
    // Warm first: on a cold pool even the FIRST job queues, because it waits
    // for the worker to compile the WebAssembly module. That startup counts as
    // queue wait, which is correct — the client is waiting for it either way —
    // but it means only a warm pool can dispatch with zero elapsed time.
    await pool.run(MISSING_FILE).catch(() => {})
    await expect(pool.run(MISSING_FILE)).rejects.not.toBeInstanceOf(
      ValidationQueueWaitError
    )
  })

  it('leaves the pool usable after refusing a stale job', async () => {
    const pool = openPool({ size: 1, queueLimit: 10, queueWaitLimitMs: 0 })
    await Promise.allSettled([pool.run(MISSING_FILE), pool.run(MISSING_FILE)])
    expect(pool.stats().size).toBe(pool.size)
    await expect(pool.run(MISSING_FILE)).rejects.toThrow()
  })

  it('waits indefinitely when no limit is configured', async () => {
    const pool = openPool({ size: 1, queueLimit: 10 })
    const outcomes = await Promise.allSettled([
      pool.run(MISSING_FILE),
      pool.run(MISSING_FILE)
    ])
    for (const outcome of outcomes) {
      expect(outcome.reason).not.toBeInstanceOf(ValidationQueueWaitError)
    }
  })
})

describe('GeosWorkerPool — giving up instead of crash-looping', () => {
  // These drive `onExit` directly with a synthetic error: the real trigger is
  // a worker whose import fails at startup, and the only way to produce that
  // with live threads would be to break the installed node_modules under the
  // running suite. The stand-in workers below are inert objects, not threads —
  // deliberately, and not only for speed: terminating a REAL worker mid-boot
  // can take the whole process down (better-sqlite3's native addon does not
  // survive its thread dying mid-dlopen), and mid-boot is exactly the window
  // these tests operate in.
  class StubWorkerPool extends GeosWorkerPool {
    spawn() {
      const record = {
        worker: {
          on() {},
          ref() {},
          unref() {},
          postMessage() {},
          terminate: () => Promise.resolve()
        },
        job: null,
        timer: null,
        ready: false
      }
      this.workers.add(record)
      return record
    }
  }

  function openStubPool(options) {
    const pool = new StubWorkerPool({
      size: 1,
      queueLimit: 4,
      timeoutMs: GENEROUS_TIMEOUT_MS,
      ...options
    })
    opened.push(pool)
    return pool
  }

  function missingModuleError() {
    const error = new Error(
      "Cannot find package 'geos-wasm' imported from geos-runtime.js"
    )
    error.code = 'ERR_MODULE_NOT_FOUND'
    return error
  }

  it('shuts the process down when a worker module cannot be loaded', async () => {
    let aborted = 0
    const pool = openStubPool({ onFatal: () => (aborted += 1) })
    const [record] = [...pool.workers]

    pool.onExit(record, missingModuleError())

    // No replacement, no retry: the pool is broken and the process is going.
    expect(aborted).toBe(1)
    expect(pool.stats().size).toBe(0)
    expect(pool.stats().broken).toBe(true)
    await expect(pool.run(MISSING_FILE)).rejects.toBeInstanceOf(
      ValidationUnavailableError
    )
  })

  it('stops replacing workers that keep dying before becoming ready', async () => {
    let aborted = 0
    const pool = openStubPool({ onFatal: () => (aborted += 1) })

    // Three startup deaths in a row — each `onExit` spawns the replacement
    // that the next iteration kills, which is the loop being guarded against.
    for (let i = 0; i < 3; i++) {
      const [record] = [...pool.workers]
      pool.onExit(record, new Error('worker crashed during startup'))
    }

    // Broken, but NOT fatal: the cause may be environmental, and the rest of
    // the service still works — so the pool refuses rather than the process
    // exiting.
    expect(aborted).toBe(0)
    expect(pool.stats().size).toBe(0)
    expect(pool.stats().broken).toBe(true)
    expect(pool.hasCapacity()).toBe(false)
    expect(pool.admit()).toBeNull()
    await expect(pool.run(MISSING_FILE)).rejects.toBeInstanceOf(
      ValidationUnavailableError
    )
  })

  it(
    'still replaces workers that die in service, however many times',
    async () => {
      // Deaths AFTER `ready` — timeouts, crashes on bad input, heap exhaustion
      // — are routine and must never trip the boot-failure guard, or a run of
      // hostile uploads could turn validation off for everyone. Real threads
      // here: waiting for idle first means each victim is past its boot.
      const pool = openPool({ size: 1 })
      for (let i = 0; i < 3; i++) {
        await waitForIdleWorker(pool)
        const [victim] = [...pool.workers]
        await victim.worker.terminate()
      }
      await waitForIdleWorker(pool)
      expect(pool.stats().size).toBe(1)
      expect(pool.stats().broken).toBe(false)
    },
    LONG_REPLACEMENT_TEST_TIMEOUT_MS
  )

  it('fails a job that was in flight when the pool gave up', async () => {
    const pool = openStubPool({ size: 2 })
    for (const record of [...pool.workers]) {
      pool.onMessage(record, { ready: true, geosVersion: 'stub' })
    }
    // Occupy one worker — the stub never answers, so the job stays in flight —
    // then break the pool by killing the OTHER worker at boot three times.
    const inFlight = pool.run(MISSING_FILE)
    for (let i = 0; i < 3; i++) {
      const idleRecord = [...pool.workers].find((record) => !record.job)
      idleRecord.ready = false
      pool.onExit(idleRecord, new Error('worker crashed during startup'))
    }
    // The busy worker was torn down with the pool, so its job must reject
    // rather than hang.
    await expect(inFlight).rejects.toBeInstanceOf(ValidationUnavailableError)
  })
})

describe('getGeosWorkerPool', () => {
  it('returns the same pool on every call, so workers are not duplicated', () => {
    const options = { size: 1, queueLimit: 1, timeoutMs: GENEROUS_TIMEOUT_MS }
    expect(getGeosWorkerPool(options)).toBe(getGeosWorkerPool(options))
  })

  it('starts a fresh pool after the shared one is closed', async () => {
    const options = { size: 1, queueLimit: 1, timeoutMs: GENEROUS_TIMEOUT_MS }
    const first = getGeosWorkerPool(options)
    await closeGeosWorkerPool()
    expect(getGeosWorkerPool(options)).not.toBe(first)
  })

  it('is safe to close when nothing was ever started', async () => {
    await closeGeosWorkerPool()
    await expect(closeGeosWorkerPool()).resolves.toBeUndefined()
  })
})

// The route answers a timeout two different ways, and this flag is the only
// thing it has to tell them apart — so it is asserted on its own rather than
// only through a pool run, where reproducing "exactly one worker, nothing
// queued" versus "something else in flight" would be a race.
describe('ValidationTimeoutError — contention', () => {
  const timeout = (pressure) => new ValidationTimeoutError(5000, pressure)

  it('is not contended when the job had the pool to itself', () => {
    // One busy worker is the timed-out job's own.
    expect(timeout({ queueDepth: 0, busyWorkers: 1 }).contended).toBe(false)
  })

  it('is contended when something was waiting behind it', () => {
    expect(timeout({ queueDepth: 1, busyWorkers: 1 }).contended).toBe(true)
  })

  it('is contended when another worker was running a job as well', () => {
    expect(timeout({ queueDepth: 0, busyWorkers: 2 }).contended).toBe(true)
  })

  it('defaults to uncontended, so a caller that says nothing is not retried', () => {
    expect(new ValidationTimeoutError(5000).contended).toBe(false)
  })

  it('still reports the budget it overran', () => {
    expect(timeout({ queueDepth: 0, busyWorkers: 1 }).message).toContain('5000')
  })
})
