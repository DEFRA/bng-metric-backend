import { describe, test, expect, vi, beforeEach } from 'vitest'

import { config } from '../../config.js'
import { metricsCounter, metricsByteSize } from './metrics.js'

const mockCounter = vi.fn()
const mockByteSize = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('@defra/cdp-metrics', () => ({
  Metrics: class {
    counter(...args) {
      return mockCounter(...args)
    }

    byteSize(...args) {
      return mockByteSize(...args)
    }
  }
}))
vi.mock('./logging/logger.js', () => ({
  createLogger: () => ({ error: (...args) => mockLoggerError(...args) })
}))

const mockMetricsName = 'mock-metrics-name'
const defaultMetricsValue = 1
const mockValue = 200
const mockDimensions = { category: 'geometric' }

describe('#metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('When metrics is not enabled', () => {
    beforeEach(async () => {
      config.set('isMetricsEnabled', false)
      await metricsCounter(mockMetricsName, mockValue)
      await metricsByteSize(mockMetricsName, mockValue)
    })

    test('Should not emit a counter', () => {
      expect(mockCounter).not.toHaveBeenCalled()
    })

    test('Should not emit a byte size', () => {
      expect(mockByteSize).not.toHaveBeenCalled()
    })
  })

  describe('When metrics is enabled', () => {
    beforeEach(() => {
      config.set('isMetricsEnabled', true)
    })

    test('Should emit a counter with the default value', async () => {
      await metricsCounter(mockMetricsName)

      expect(mockCounter).toHaveBeenCalledWith(
        mockMetricsName,
        defaultMetricsValue,
        {}
      )
    })

    test('Should emit a counter with a value and dimensions', async () => {
      await metricsCounter(mockMetricsName, mockValue, mockDimensions)

      expect(mockCounter).toHaveBeenCalledWith(
        mockMetricsName,
        mockValue,
        mockDimensions
      )
    })

    test('Should emit a byte size with a value', async () => {
      await metricsByteSize(mockMetricsName, mockValue)

      expect(mockByteSize).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })
  })

  describe('When the underlying metric call throws', () => {
    const mockError = new Error('mock-metrics-put-error')

    beforeEach(async () => {
      config.set('isMetricsEnabled', true)
      mockCounter.mockRejectedValueOnce(mockError)

      await metricsCounter(mockMetricsName, mockValue)
    })

    test('Should log the error and not rethrow', () => {
      expect(mockLoggerError).toHaveBeenCalledWith(mockError, mockError.message)
    })
  })
})
