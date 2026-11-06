import { afterEach, describe, expect, it, vi } from 'vitest'
import Hapi from '@hapi/hapi'

import { config } from '../config.js'
import { metricsCounter } from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_BUSY_REASON
} from '../common/helpers/metric-names.js'
import {
  memoryShed,
  memoryShedOptionsFromConfig,
  resolveMaxRssBytes
} from './memory-shed.js'

const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn() })
}))

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(() => Promise.resolve())
}))

// Far above what any test process uses, and 1 byte, which it always exceeds.
const NEVER_REACHED = 100 * 1024 * 1024 * 1024
const ALWAYS_EXCEEDED = 1
const RETRY_AFTER_SECONDS = 5
const SAMPLE_INTERVAL_MS = 10

describe('memory-shed plugin', () => {
  let server

  afterEach(async () => {
    await server?.stop()
  })

  async function serverWith(maxRssBytes) {
    // As the real server. Hapi applies stripTrailingSlash when it builds the
    // request, before onRequest runs, so the extension already sees `/health/`
    // as `/health`; the case below pins that.
    server = Hapi.server({ router: { stripTrailingSlash: true } })
    await server.register({
      plugin: memoryShed.plugin,
      options: {
        maxRssBytes,
        source: 'test',
        sampleIntervalMs: SAMPLE_INTERVAL_MS,
        retryAfterSeconds: RETRY_AFTER_SECONDS
      }
    })
    server.route([
      {
        method: 'POST',
        path: '/validate',
        handler: () => ({ valid: true })
      },
      {
        method: 'GET',
        path: '/health',
        handler: () => ({ message: 'success' })
      }
    ])
    await server.initialize()
  }

  it('refuses with the busy 503 the frontend retries on, once RSS is over the ceiling', async () => {
    await serverWith(ALWAYS_EXCEEDED)

    const res = await server.inject({ method: 'POST', url: '/validate' })

    expect(res.statusCode).toBe(503)
    expect(res.headers['retry-after']).toBe(String(RETRY_AFTER_SECONDS))
    expect(res.result.errors[0].code).toBe('VALIDATION_BUSY')
  })

  it('logs and counts refusals once per sample, not once per request', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      await serverWith(ALWAYS_EXCEEDED)

      for (let i = 0; i < 3; i++) {
        await server.inject({ method: 'POST', url: '/validate' })
      }
      expect(mockWarn).not.toHaveBeenCalled()
      expect(metricsCounter).not.toHaveBeenCalled()

      vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)

      expect(mockWarn).toHaveBeenCalledTimes(1)
      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('3 request(s) refused as busy')
      )
      expect(metricsCounter).toHaveBeenCalledTimes(1)
      expect(metricsCounter).toHaveBeenCalledWith(
        GEOPACKAGE_METRIC.validationBusy,
        3,
        { reason: VALIDATION_BUSY_REASON.memoryRss }
      )

      vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
      expect(metricsCounter).toHaveBeenCalledTimes(1)

      // Stop while the interval is still a fake one, so it is cleared.
      await server.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['/health', '/health/'])(
    'still answers %s when RSS is over the ceiling',
    async (url) => {
      await serverWith(ALWAYS_EXCEEDED)

      const res = await server.inject({ method: 'GET', url })

      expect(res.statusCode).toBe(200)
    }
  )

  it('serves normally when the ceiling is above actual usage', async () => {
    await serverWith(NEVER_REACHED)

    const res = await server.inject({ method: 'POST', url: '/validate' })

    expect(res.statusCode).toBe(200)
  })

  describe('when the ceiling is off', () => {
    const cdpEnvironment = config.get('cdpEnvironment')

    afterEach(() => {
      config.set('cdpEnvironment', cdpEnvironment)
    })

    it('serves normally and warns in a deployed environment', async () => {
      config.set('cdpEnvironment', 'prod')
      await serverWith(0)

      const res = await server.inject({ method: 'POST', url: '/validate' })

      expect(res.statusCode).toBe(200)
      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('Memory ceiling is off (test)')
      )
    })

    it('stays quiet locally', async () => {
      config.set('cdpEnvironment', 'local')
      await serverWith(0)

      expect(mockWarn).not.toHaveBeenCalled()
    })
  })

  it('reads its options from config', () => {
    const configured = config.get('validation.maxRssBytes')
    config.set('validation.maxRssBytes', 1234)

    try {
      expect(memoryShedOptionsFromConfig()).toEqual({
        maxRssBytes: 1234,
        source: 'VALIDATION_MAX_RSS_BYTES',
        sampleIntervalMs: config.get('validation.loadSampleIntervalMs'),
        retryAfterSeconds: config.get('validation.busyRetryAfterSeconds')
      })
    } finally {
      config.set('validation.maxRssBytes', configured)
    }
  })
})

describe('resolveMaxRssBytes', () => {
  const GIB = 1024 * 1024 * 1024
  const PARSE_BUDGET = 576716800

  it('uses an explicit value in any environment', () => {
    expect(
      resolveMaxRssBytes({
        configured: 2 * GIB,
        deployed: true,
        taskMemory: 4 * GIB,
        parseBudget: PARSE_BUDGET
      }).maxRssBytes
    ).toBe(2 * GIB)
  })

  it('is off when explicitly set to 0, even when deployed', () => {
    expect(
      resolveMaxRssBytes({
        configured: 0,
        deployed: true,
        taskMemory: 4 * GIB,
        parseBudget: PARSE_BUDGET
      }).maxRssBytes
    ).toBe(0)
  })

  it('defaults to task memory less the parse budget when deployed', () => {
    // perf-test's 4 GiB task: the value proved there by hand.
    expect(
      resolveMaxRssBytes({
        configured: null,
        deployed: true,
        taskMemory: 4 * GIB,
        parseBudget: PARSE_BUDGET
      }).maxRssBytes
    ).toBe(3718250496)
  })

  it('is off locally when unset', () => {
    expect(
      resolveMaxRssBytes({
        configured: null,
        deployed: false,
        taskMemory: 32 * GIB,
        parseBudget: PARSE_BUDGET
      })
    ).toEqual({ maxRssBytes: 0, source: 'local' })
  })

  it('stays off, and says why, when the task is too small for a useful default', () => {
    const { maxRssBytes, source } = resolveMaxRssBytes({
      configured: null,
      deployed: true,
      taskMemory: GIB,
      parseBudget: PARSE_BUDGET
    })

    expect(maxRssBytes).toBe(0)
    expect(source).toContain('too small')
  })
})
