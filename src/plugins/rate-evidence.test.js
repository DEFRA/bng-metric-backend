import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import { rateEvidence } from './rate-evidence.js'
import { PERF_EVIDENCE_MARKER } from '../common/helpers/perf-evidence.js'

const BURST_THRESHOLD = 300
const WINDOW_MS = 10_000
const LOG_COOLDOWN_MS = 5_000

/**
 * Register the plugin against a stub server and hand back the `onRequest`
 * extension it installed, plus the logger it will write evidence to.
 */
function registerPlugin() {
  const info = vi.fn()
  let onRequest
  const server = {
    logger: { info },
    ext: (event, handler) => {
      expect(event).toBe('onRequest')
      onRequest = handler
    }
  }

  rateEvidence.plugin.register(server)
  return { onRequest, info }
}

const h = { continue: Symbol('continue') }

function requestFrom(ip, path = '/reference/broad-habitats', headers = {}) {
  return {
    info: { remoteAddress: ip },
    headers,
    path,
    method: 'get'
  }
}

/** Drive `count` requests through the extension from one source address. */
function burst(onRequest, count, request = requestFrom('10.0.0.1')) {
  for (let i = 0; i < count; i += 1) {
    onRequest(request, h)
  }
}

describe('#rateEvidence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T09:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('Should always continue the request — it never throttles', () => {
    const { onRequest } = registerPlugin()

    expect(onRequest(requestFrom('10.0.0.1'), h)).toBe(h.continue)
  })

  test('Should stay silent below the burst threshold', () => {
    const { onRequest, info } = registerPlugin()

    burst(onRequest, BURST_THRESHOLD)

    expect(info).not.toHaveBeenCalled()
  })

  test('Should log an evidence line once the service is driven past the threshold', () => {
    const { onRequest, info } = registerPlugin()

    burst(
      onRequest,
      BURST_THRESHOLD + 1,
      requestFrom('10.0.0.1', '/reference/conditions')
    )

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        [PERF_EVIDENCE_MARKER]: 'no-rate-limit',
        windowRequests: BURST_THRESHOLD + 1,
        windowMs: WINDOW_MS,
        path: '/reference/conditions',
        method: 'get'
      }),
      'perf-evidence: no-rate-limit'
    )
  })

  test('Should count every source together, not per address', () => {
    const { onRequest, info } = registerPlugin()

    // Behind the load balancer the peer address is the balancer's, so a burst
    // spread across addresses is still one uncapped request rate.
    for (let i = 0; i <= BURST_THRESHOLD; i += 1) {
      onRequest(requestFrom(`10.0.${Math.floor(i / 256)}.${i % 256}`), h)
    }

    expect(info).toHaveBeenCalledTimes(1)
  })

  test('Should record the peer address and forwarded-for chain as attributes', () => {
    const { onRequest, info } = registerPlugin()

    burst(
      onRequest,
      BURST_THRESHOLD + 1,
      requestFrom('10.0.0.1', '/reference/conditions', {
        'x-forwarded-for': '203.0.113.7, 10.0.0.9'
      })
    )

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteAddress: '10.0.0.1',
        forwardedFor: '203.0.113.7, 10.0.0.9'
      }),
      'perf-evidence: no-rate-limit'
    )
  })

  test('Should fall back to placeholders when neither address is present', () => {
    const { onRequest, info } = registerPlugin()

    burst(onRequest, BURST_THRESHOLD + 1, {
      info: {},
      path: '/reference/conditions',
      method: 'get'
    })

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ remoteAddress: 'unknown', forwardedFor: null }),
      'perf-evidence: no-rate-limit'
    )
  })

  test('Should rate-limit its own logging, not the requests', () => {
    const { onRequest, info } = registerPlugin()

    burst(onRequest, BURST_THRESHOLD + 5)
    expect(info).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(LOG_COOLDOWN_MS + 1)
    onRequest(requestFrom('10.0.0.1'), h)

    expect(info).toHaveBeenCalledTimes(2)
  })

  test('Should drop requests that age out of the window', () => {
    const { onRequest, info } = registerPlugin()

    burst(onRequest, BURST_THRESHOLD)
    vi.advanceTimersByTime(WINDOW_MS + 1)
    burst(onRequest, BURST_THRESHOLD)

    // The first batch aged out entirely, so the window never passed the
    // threshold — the count slides rather than accumulating.
    expect(info).not.toHaveBeenCalled()
  })

  test('Should keep counting requests still inside the window', () => {
    const { onRequest, info } = registerPlugin()

    burst(onRequest, BURST_THRESHOLD - 100)
    vi.advanceTimersByTime(WINDOW_MS / 2)
    burst(onRequest, 101)

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ windowRequests: BURST_THRESHOLD + 1 }),
      'perf-evidence: no-rate-limit'
    )
  })

  test('Should leave the load balancer health probes out of the count', () => {
    const { onRequest, info } = registerPlugin()

    burst(onRequest, BURST_THRESHOLD + 1, requestFrom('10.0.0.1', '/health'))
    burst(onRequest, BURST_THRESHOLD + 1, requestFrom('10.0.0.1', '/health/'))

    expect(info).not.toHaveBeenCalled()
    expect(onRequest(requestFrom('10.0.0.1', '/health'), h)).toBe(h.continue)
  })
})
