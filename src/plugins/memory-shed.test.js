import { afterEach, describe, expect, it, vi } from 'vitest'
import Hapi from '@hapi/hapi'

import { config } from '../config.js'
import { memoryShed, memoryShedOptionsFromConfig } from './memory-shed.js'

const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn() })
}))

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn()
}))

// Far above what any test process uses, and 1 byte, which it always exceeds.
const NEVER_REACHED = 100 * 1024 * 1024 * 1024
const ALWAYS_EXCEEDED = 1
const RETRY_AFTER_SECONDS = 5

describe('memory-shed plugin', () => {
  let server

  afterEach(async () => {
    await server?.stop()
  })

  async function serverWith(maxRssBytes) {
    server = Hapi.server()
    await server.register({
      plugin: memoryShed.plugin,
      options: {
        maxRssBytes,
        sampleIntervalMs: 10,
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

  it('still answers /health when RSS is over the ceiling', async () => {
    await serverWith(ALWAYS_EXCEEDED)

    const res = await server.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
  })

  it('serves normally when the ceiling is above actual usage', async () => {
    await serverWith(NEVER_REACHED)

    const res = await server.inject({ method: 'POST', url: '/validate' })

    expect(res.statusCode).toBe(200)
  })

  describe('when no ceiling is configured', () => {
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
        expect.stringContaining('VALIDATION_MAX_RSS_BYTES is not set')
      )
    })

    it('stays quiet locally', async () => {
      config.set('cdpEnvironment', 'local')
      await serverWith(0)

      expect(mockWarn).not.toHaveBeenCalled()
    })
  })

  it('reads its options from config', () => {
    expect(memoryShedOptionsFromConfig()).toEqual({
      maxRssBytes: config.get('validation.maxRssBytes'),
      sampleIntervalMs: config.get('validation.loadSampleIntervalMs'),
      retryAfterSeconds: config.get('validation.busyRetryAfterSeconds')
    })
  })
})
