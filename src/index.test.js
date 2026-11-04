import { describe, test, expect, vi } from 'vitest'
import process from 'node:process'

import { FATAL_EXIT_FLUSH_MS } from './common/helpers/exit-process.js'

vi.mock('./common/helpers/start-server.js', () => ({
  startServer: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn()
  })
}))

describe('#index', () => {
  test('Should start the server', async () => {
    const { startServer } = await import('./common/helpers/start-server.js')

    await import('./index.js')

    expect(startServer).toHaveBeenCalled()
  })

  test('Should handle unhandled rejections', async () => {
    const { createLogger } = await import('./common/helpers/logging/logger.js')
    const mockLogger = createLogger()

    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {})
    vi.useFakeTimers()

    try {
      await import('./index.js')

      const error = new Error('test error')
      process.emit('unhandledRejection', error)

      expect(mockLogger.info).toHaveBeenCalledWith('Unhandled rejection')
      expect(mockLogger.error).toHaveBeenCalledWith(error)
      expect(process.exitCode).toBe(1)
      // The exit waits for the logger to flush.
      expect(exit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(FATAL_EXIT_FLUSH_MS)

      expect(exit).toHaveBeenCalledWith(1)
    } finally {
      vi.useRealTimers()
      exit.mockRestore()
      process.exitCode = undefined
    }
  })
})
