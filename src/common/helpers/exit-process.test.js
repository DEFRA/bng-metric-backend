import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import process from 'node:process'

import {
  FATAL_EXIT_FLUSH_MS,
  FATAL_STOP_TIMEOUT_MS,
  createFatalShutdown,
  exitProcessAfterFlush
} from './exit-process.js'

describe('#exit-process', () => {
  let exit

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    exit.mockRestore()
    process.exitCode = undefined
  })

  test('exitProcessAfterFlush sets the exit code at once and exits after the flush', () => {
    exitProcessAfterFlush()

    expect(process.exitCode).toBe(1)
    vi.advanceTimersByTime(FATAL_EXIT_FLUSH_MS - 1)
    expect(exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  test('createFatalShutdown stops the server once, then exits', async () => {
    const server = { stop: vi.fn().mockResolvedValue(undefined) }
    const shutDown = createFatalShutdown(server)

    shutDown()
    shutDown()

    expect(server.stop).toHaveBeenCalledTimes(1)
    expect(server.stop).toHaveBeenCalledWith({
      timeout: FATAL_STOP_TIMEOUT_MS
    })
    expect(process.exitCode).toBe(1)

    await vi.advanceTimersByTimeAsync(FATAL_EXIT_FLUSH_MS)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  test('createFatalShutdown waits for the stop to finish before the flush delay starts', async () => {
    let finishStop
    const server = {
      stop: vi.fn(
        () =>
          new Promise((resolve) => {
            finishStop = resolve
          })
      )
    }

    createFatalShutdown(server)()

    // Requests are still draining: no exit, however long that takes.
    await vi.advanceTimersByTimeAsync(FATAL_EXIT_FLUSH_MS * 5)
    expect(exit).not.toHaveBeenCalled()

    finishStop()
    await vi.advanceTimersByTimeAsync(FATAL_EXIT_FLUSH_MS - 1)
    expect(exit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  test('createFatalShutdown still exits with code 1 when the stop fails', async () => {
    const server = {
      stop: vi
        .fn()
        .mockRejectedValue(
          new Error('Cannot stop server while in stopping phase')
        )
    }

    createFatalShutdown(server)()

    await vi.advanceTimersByTimeAsync(FATAL_EXIT_FLUSH_MS)
    expect(exit).toHaveBeenCalledWith(1)
  })
})
