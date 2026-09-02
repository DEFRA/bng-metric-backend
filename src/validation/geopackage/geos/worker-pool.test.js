import { availableParallelism } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import {
  GeosWorkerPool,
  ValidationQueueFullError,
  ValidationTimeoutError,
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
const GENEROUS_TIMEOUT_MS = 30_000

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

  it('always starts at least one worker, however small the setting', () => {
    expect(openPool({ size: 0 }).size).toBe(1)
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
    // One millisecond is not enough to load a GeoPackage, so the job overruns
    // and the pool has to terminate the thread to get out of it.
    const pool = openPool({ timeoutMs: 1 })
    await expect(pool.run(MISSING_FILE)).rejects.toBeInstanceOf(
      ValidationTimeoutError
    )
    // The replacement takes a moment to announce itself; the pool must not have
    // shrunk in the meantime.
    expect(pool.stats().size).toBe(pool.size)
  })

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
