import { describe, it, expect, vi, beforeEach } from 'vitest'

// The failure paths need a worker that misbehaves on demand, which a real
// thread will not do: a module-load error, a thread that dies without
// reporting, and a terminate() that rejects.
const workers = []

vi.mock('node:worker_threads', () => ({
  Worker: class FakeWorker {
    constructor() {
      this.handlers = new Map()
      this.postMessage = vi.fn()
      this.terminate = vi.fn().mockResolvedValue(0)
      workers.push(this)
    }

    on(event, handler) {
      this.handlers.set(event, handler)
    }

    emit(event, value) {
      this.handlers.get(event)?.(value)
    }
  }
}))

const { runParseInWorker } = await import('./run-parse-in-worker.js')

beforeEach(() => {
  workers.length = 0
})

/** Start a parse and hand back the promise plus the worker standing in for it. */
function startParse(buffer = Buffer.alloc(16)) {
  const promise = runParseInWorker(buffer)
  return { promise, worker: workers.at(-1) }
}

describe('runParseInWorker failure handling', () => {
  it('rejects when the worker fails to start', async () => {
    const { promise, worker } = startParse()

    worker.emit('error', new Error('Cannot find module'))

    await expect(promise).rejects.toThrow('Cannot find module')
  })

  it('rejects when the thread dies without reporting', async () => {
    // An OOM abort looks like this: no message, just an exit. Without the exit
    // handler the job would hang until the reaper picked it up.
    const { promise, worker } = startParse()

    worker.emit('exit', 1)

    await expect(promise).rejects.toThrow(/exited unexpectedly with code 1/)
  })

  it('ignores the exit that follows a successful parse', async () => {
    const { promise, worker } = startParse()

    worker.emit('message', { ok: true, valid: true, errors: [], layers: {} })
    worker.emit('exit', 0)

    await expect(promise).resolves.toMatchObject({ valid: true })
  })

  it('still settles when terminating the worker fails', async () => {
    const { promise, worker } = startParse()
    worker.terminate.mockRejectedValue(new Error('already gone'))

    worker.emit('message', { ok: true, valid: true, errors: [], layers: null })

    await expect(promise).resolves.toMatchObject({ valid: true })
  })

  it('restores the error name reported from the other thread', async () => {
    const { promise, worker } = startParse()

    worker.emit('message', {
      ok: false,
      name: 'RangeError',
      message: 'Unsupported SRID 3857'
    })

    await expect(promise).rejects.toMatchObject({
      name: 'RangeError',
      message: 'Unsupported SRID 3857'
    })
  })

  it('defaults the error name when the worker reported none', async () => {
    const { promise, worker } = startParse()

    worker.emit('message', { ok: false, message: 'something went wrong' })

    await expect(promise).rejects.toMatchObject({ name: 'Error' })
  })

  it('transfers the buffer when it owns its whole ArrayBuffer', async () => {
    // A 100MB upload must not be copied to cross the thread boundary.
    const owned = Buffer.from(new ArrayBuffer(1024))
    const { promise, worker } = startParse(owned)

    const [, transferList] = worker.postMessage.mock.calls[0]
    expect(transferList).toEqual([owned.buffer])

    worker.emit('message', { ok: true, valid: true, errors: [], layers: null })
    await promise
  })

  it('copies instead of transferring a buffer that is a view into the pool', async () => {
    // Detaching a pooled ArrayBuffer would take unrelated buffers with it.
    const pooled = Buffer.from('small')
    const { promise, worker } = startParse(pooled)

    const [, transferList] = worker.postMessage.mock.calls[0]
    expect(transferList).toEqual([])

    worker.emit('message', { ok: true, valid: true, errors: [], layers: null })
    await promise
  })
})
