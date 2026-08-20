/**
 * A counting semaphore with a bounded wait.
 *
 * Node runs one request's JavaScript at a time, but every `await` hands the
 * event loop to another request — so work that looks serial interleaves, and
 * whatever each request is holding stays on the heap while it waits. A
 * semaphore is what turns "as many at once as arrive" into a number.
 *
 * A caller that cannot get a permit within `timeoutMs` is rejected rather than
 * queued indefinitely: a request the client has already given up on should not
 * go on to claim a permit ahead of a live one.
 */

/** Thrown when a caller waited for a permit longer than it was willing to. */
class SemaphoreTimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SemaphoreTimeoutError'
  }
}

/**
 * @param {number} permits how many holders may run at once
 * @param {{ name?: string }} [options] name used in timeout messages
 */
function createSemaphore(permits, { name = 'semaphore' } = {}) {
  if (!Number.isInteger(permits) || permits < 1) {
    throw new Error(`${name}: permits must be a positive integer`)
  }

  let available = permits
  /** @type {Array<{ resolve: () => void, reject: (err: Error) => void, timer: NodeJS.Timeout }>} */
  const waiters = []

  function settleNextWaiter() {
    const waiter = waiters.shift()
    if (!waiter) {
      available += 1
      return
    }
    clearTimeout(waiter.timer)
    waiter.resolve()
  }

  function dropWaiter(waiter) {
    const index = waiters.indexOf(waiter)
    if (index !== -1) {
      waiters.splice(index, 1)
    }
  }

  function acquire(timeoutMs) {
    if (available > 0) {
      available -= 1
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        dropWaiter(waiter)
        reject(
          new SemaphoreTimeoutError(
            `${name}: waited ${timeoutMs}ms for a permit (${permits} in use, ${waiters.length} still queued)`
          )
        )
      }, timeoutMs)
      // The queue must never be the reason the process stays alive.
      waiter.timer.unref?.()
      waiters.push(waiter)
    })
  }

  return {
    /**
     * Run `fn` holding a permit, releasing it however `fn` settles.
     *
     * @param {number} timeoutMs how long to wait for a permit
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     * @throws {SemaphoreTimeoutError} when no permit came free in time
     * @template T
     */
    async run(timeoutMs, fn) {
      await acquire(timeoutMs)
      try {
        return await fn()
      } finally {
        settleNextWaiter()
      }
    },

    /** Permits currently held, for logging and tests. */
    inUse() {
      return permits - available
    },

    /** Callers waiting for a permit, for logging and tests. */
    queued() {
      return waiters.length
    }
  }
}

export { createSemaphore, SemaphoreTimeoutError }
