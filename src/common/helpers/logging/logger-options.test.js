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

describe('#loggerOptions', () => {
  describe('#mixin', () => {
    test('Should return trace id when available', () => {
      getCorrelationId.mockReturnValue(null)
      getTraceId.mockReturnValue('test-trace-id')

      const result = loggerOptions.mixin()

      expect(result).toEqual({ trace: { id: 'test-trace-id' } })
    })

    test('Should return empty object when no trace id', () => {
      getCorrelationId.mockReturnValue(null)
      getTraceId.mockReturnValue(null)

      const result = loggerOptions.mixin()

      expect(result).toEqual({})
    })

    test('Should prefer correlation id over trace id when available', () => {
      getCorrelationId.mockReturnValue('test-correlation-id')
      getTraceId.mockReturnValue('test-trace-id')

      const result = loggerOptions.mixin()

      expect(result).toEqual({ trace: { id: 'test-correlation-id' } })
    })
  })
})
