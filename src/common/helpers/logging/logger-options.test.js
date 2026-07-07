import { describe, test, expect, vi } from 'vitest'
import { getTraceId } from '@defra/hapi-tracing'
import { getCorrelationId } from '../correlation-id.js'

import { loggerOptions } from './logger-options.js'

vi.mock('@defra/hapi-tracing', () => ({
  getTraceId: vi.fn()
}))

vi.mock('../correlation-id.js', () => ({
  getCorrelationId: vi.fn()
}))

function loggerWithBindings(bindings) {
  return { bindings: vi.fn().mockReturnValue(bindings) }
}

describe('#loggerOptions', () => {
  describe('#mixin', () => {
    test('Should add trace id and session id when no bindings are available', () => {
      getTraceId.mockReturnValue('test-trace-id')
      getCorrelationId.mockReturnValue('test-correlation-id')

      const result = loggerOptions.mixin({}, 30, loggerWithBindings({}))

      expect(result).toEqual({
        trace: { id: 'test-trace-id' },
        session: { id: 'test-correlation-id' }
      })
    })

    test('Should return trace id when no session id is available', () => {
      getCorrelationId.mockReturnValue(null)
      getTraceId.mockReturnValue('test-trace-id')

      const result = loggerOptions.mixin({}, 30, loggerWithBindings({}))

      expect(result).toEqual({ trace: { id: 'test-trace-id' } })
    })

    test('Should return session id when no trace id is available', () => {
      getCorrelationId.mockReturnValue('test-correlation-id')
      getTraceId.mockReturnValue(null)

      const result = loggerOptions.mixin({}, 30, loggerWithBindings({}))

      expect(result).toEqual({ session: { id: 'test-correlation-id' } })
    })

    test('Should not overwrite existing trace or session bindings', () => {
      getCorrelationId.mockReturnValue('test-correlation-id')
      getTraceId.mockReturnValue('test-trace-id')

      const result = loggerOptions.mixin(
        {},
        30,
        loggerWithBindings({
          trace: { id: 'bound-trace-id' },
          session: { id: 'bound-session-id' }
        })
      )

      expect(result).toEqual({})
    })

    test('Should still add session id when logger already has a trace binding', () => {
      getCorrelationId.mockReturnValue('test-correlation-id')
      getTraceId.mockReturnValue('test-trace-id')

      const result = loggerOptions.mixin(
        {},
        30,
        loggerWithBindings({ trace: { id: 'bound-trace-id' } })
      )

      expect(result).toEqual({ session: { id: 'test-correlation-id' } })
    })

    test('Should still add trace id when logger already has a session binding', () => {
      getCorrelationId.mockReturnValue('test-correlation-id')
      getTraceId.mockReturnValue('test-trace-id')

      const result = loggerOptions.mixin(
        {},
        30,
        loggerWithBindings({ session: { id: 'bound-session-id' } })
      )

      expect(result).toEqual({ trace: { id: 'test-trace-id' } })
    })

    test('Should return empty object when no trace id or session id', () => {
      getCorrelationId.mockReturnValue(null)
      getTraceId.mockReturnValue(null)

      const result = loggerOptions.mixin({}, 30, loggerWithBindings({}))

      expect(result).toEqual({})
    })
  })
})
