import { describe, it, expect } from 'vitest'

import { createSemaphore, SemaphoreTimeoutError } from './semaphore.js'

const A_LONG_TIME_MS = 60_000
const NO_WAIT_MS = 1

/** A promise plus the handles to settle it, so tests control when work ends. */
function deferred() {
  return Promise.withResolvers()
}

/** Let every already-scheduled microtask and timer callback run. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createSemaphore permit validation', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects %s permits', (permits) => {
    expect(() => createSemaphore(permits)).toThrow(/positive integer/)
  })
})

describe('createSemaphore under the limit', () => {
  it('runs work immediately when a permit is free', async () => {
    const semaphore = createSemaphore(1)

    await expect(
      semaphore.run(A_LONG_TIME_MS, async () => 'done')
    ).resolves.toBe('done')
  })

  it('releases the permit once the work settles', async () => {
    const semaphore = createSemaphore(1)

    await semaphore.run(A_LONG_TIME_MS, async () => 'done')

    expect(semaphore.inUse()).toBe(0)
  })

  it('releases the permit when the work throws', async () => {
    const semaphore = createSemaphore(1)

    await expect(
      semaphore.run(A_LONG_TIME_MS, async () => {
        throw new Error('work failed')
      })
    ).rejects.toThrow('work failed')
    expect(semaphore.inUse()).toBe(0)
  })
})

describe('createSemaphore at the limit', () => {
  it('holds a third caller until one of two permits frees', async () => {
    const semaphore = createSemaphore(2)
    const first = deferred()
    const second = deferred()

    const running = [
      semaphore.run(A_LONG_TIME_MS, () => first.promise),
      semaphore.run(A_LONG_TIME_MS, () => second.promise)
    ]
    let thirdStarted = false
    const third = semaphore.run(A_LONG_TIME_MS, async () => {
      thirdStarted = true
    })
    await flush()

    expect(thirdStarted).toBe(false)
    expect(semaphore.inUse()).toBe(2)
    expect(semaphore.queued()).toBe(1)

    first.resolve()
    await Promise.all([...running.slice(0, 1), third])
    expect(thirdStarted).toBe(true)

    second.resolve()
    await Promise.all(running)
    expect(semaphore.inUse()).toBe(0)
  })

  it('hands the freed permit to the caller that waited longest', async () => {
    const semaphore = createSemaphore(1)
    const holder = deferred()
    const order = []

    const held = semaphore.run(A_LONG_TIME_MS, () => holder.promise)
    const queued = [
      semaphore.run(A_LONG_TIME_MS, async () => order.push('first')),
      semaphore.run(A_LONG_TIME_MS, async () => order.push('second'))
    ]
    await flush()

    holder.resolve()
    await Promise.all([held, ...queued])

    expect(order).toEqual(['first', 'second'])
  })
})

describe('createSemaphore when the queue wait runs out', () => {
  it('rejects with SemaphoreTimeoutError', async () => {
    const semaphore = createSemaphore(1)
    const holder = deferred()
    const held = semaphore.run(A_LONG_TIME_MS, () => holder.promise)

    await expect(
      semaphore.run(NO_WAIT_MS, async () => 'never runs')
    ).rejects.toThrow(SemaphoreTimeoutError)

    holder.resolve()
    await held
  })

  it('never runs the work it rejected', async () => {
    const semaphore = createSemaphore(1)
    const holder = deferred()
    const held = semaphore.run(A_LONG_TIME_MS, () => holder.promise)
    let ran = false

    await expect(
      semaphore.run(NO_WAIT_MS, async () => {
        ran = true
      })
    ).rejects.toThrow(SemaphoreTimeoutError)

    holder.resolve()
    await held
    await flush()
    expect(ran).toBe(false)
  })

  it('drops the timed-out caller from the queue, so it claims no later permit', async () => {
    const semaphore = createSemaphore(1)
    const holder = deferred()
    const held = semaphore.run(A_LONG_TIME_MS, () => holder.promise)

    await expect(
      semaphore.run(NO_WAIT_MS, async () => 'never runs')
    ).rejects.toThrow(SemaphoreTimeoutError)
    expect(semaphore.queued()).toBe(0)

    holder.resolve()
    await held
    expect(semaphore.inUse()).toBe(0)
  })

  it('names the semaphore in the message so logs identify the queue', async () => {
    const semaphore = createSemaphore(1, { name: 'geopackage-validation' })
    const holder = deferred()
    const held = semaphore.run(A_LONG_TIME_MS, () => holder.promise)

    await expect(
      semaphore.run(NO_WAIT_MS, async () => 'never runs')
    ).rejects.toThrow(/geopackage-validation/)

    holder.resolve()
    await held
  })
})
