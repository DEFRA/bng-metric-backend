import { describe, test, expect, vi } from 'vitest'
import { getTraceId } from '@defra/hapi-tracing'

import { loggerOptions } from './logger-options.js'

vi.mock('@defra/hapi-tracing', () => ({
  getTraceId: vi.fn()
}))

describe('#loggerOptions', () => {
  describe('#mixin', () => {
    test('Should return trace id when available', () => {
      getTraceId.mockReturnValue('test-trace-id')

      const result = loggerOptions.mixin()

      expect(result).toEqual({ trace: { id: 'test-trace-id' } })
    })

    test('Should return empty object when no trace id', () => {
      getTraceId.mockReturnValue(null)

      const result = loggerOptions.mixin()

      expect(result).toEqual({})
    })
  })
})
