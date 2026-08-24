import { describe, test, expect, vi, beforeEach } from 'vitest'

import { config } from '../../config.js'
import {
  metricsCounter,
  metricsByteSize,
  metricsMillis,
  metricsGauge
} from './metrics.js'

const mockCounter = vi.fn()
const mockByteSize = vi.fn()
const mockMillis = vi.fn()
const mockGauge = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('@defra/cdp-metrics', () => ({
  Metrics: class {
    counter(...args) {
      return mockCounter(...args)
    }

    byteSize(...args) {
      return mockByteSize(...args)
    }

    millis(...args) {
      return mockMillis(...args)
    }

    gauge(...args) {
      return mockGauge(...args)
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
const mockDocumentDimensions = { documentKey: 'baseline' }

describe('#metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('When metrics is not enabled', () => {
    beforeEach(async () => {
      config.set('isMetricsEnabled', false)
      await metricsCounter(mockMetricsName, mockValue)
      await metricsByteSize(mockMetricsName, mockValue)
      await metricsMillis(mockMetricsName, mockValue)
      await metricsGauge(mockMetricsName, mockValue)
    })

    test('Should not emit a counter', () => {
      expect(mockCounter).not.toHaveBeenCalled()
    })

    test('Should not emit a byte size', () => {
      expect(mockByteSize).not.toHaveBeenCalled()
    })

    test('Should not emit a duration', () => {
      expect(mockMillis).not.toHaveBeenCalled()
    })

    test('Should not emit a gauge', () => {
      expect(mockGauge).not.toHaveBeenCalled()
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

    test('Should emit a duration with a value', async () => {
      await metricsMillis(mockMetricsName, mockValue)

      expect(mockMillis).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should emit a duration with dimensions', async () => {
      await metricsMillis(mockMetricsName, mockValue, mockDocumentDimensions)

      expect(mockMillis).toHaveBeenCalledWith(
        mockMetricsName,
        mockValue,
        mockDocumentDimensions
      )
    })

    test('Should emit a gauge with a value', async () => {
      await metricsGauge(mockMetricsName, mockValue)

      expect(mockGauge).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
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
