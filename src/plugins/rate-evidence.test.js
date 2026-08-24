import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import { rateEvidence } from './rate-evidence.js'
import { PERF_EVIDENCE_MARKER } from '../common/helpers/perf-evidence.js'

const BURST_THRESHOLD = 30
const WINDOW_MS = 10_000
const LOG_COOLDOWN_MS = 1_000
const MAX_TRACKED_CLIENTS = 10_000

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

function requestFrom(ip, path = '/reference/broad-habitats') {
  return {
    info: { remoteAddress: ip },
    path,
    method: 'get'
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

    for (let i = 0; i < BURST_THRESHOLD; i += 1) {
      onRequest(requestFrom('10.0.0.1'), h)
    }

    expect(info).not.toHaveBeenCalled()
  })

  test('Should log an evidence line once a client bursts past the threshold', () => {
    const { onRequest, info } = registerPlugin()

    for (let i = 0; i <= BURST_THRESHOLD; i += 1) {
      onRequest(requestFrom('10.0.0.1', '/reference/conditions'), h)
    }

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        [PERF_EVIDENCE_MARKER]: 'no-rate-limit',
        clientIp: '10.0.0.1',
        windowRequests: BURST_THRESHOLD + 1,
        windowMs: WINDOW_MS,
        path: '/reference/conditions',
        method: 'get'
      }),
      'perf-evidence: no-rate-limit'
    )
  })

  test('Should rate-limit its own logging, not the requests', () => {
    const { onRequest, info } = registerPlugin()

    for (let i = 0; i < BURST_THRESHOLD + 5; i += 1) {
      onRequest(requestFrom('10.0.0.1'), h)
    }
    expect(info).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(LOG_COOLDOWN_MS + 1)
    onRequest(requestFrom('10.0.0.1'), h)

    expect(info).toHaveBeenCalledTimes(2)
  })

  test('Should drop timestamps that age out of the window', () => {
    const { onRequest, info } = registerPlugin()

    for (let i = 0; i < BURST_THRESHOLD; i += 1) {
      onRequest(requestFrom('10.0.0.1'), h)
    }
    vi.advanceTimersByTime(WINDOW_MS + 1)
    onRequest(requestFrom('10.0.0.1'), h)

    // The window emptied, so the client is back to a single request.
    expect(info).not.toHaveBeenCalled()
  })

  test('Should count each client separately', () => {
    const { onRequest, info } = registerPlugin()

    for (let i = 0; i <= BURST_THRESHOLD; i += 1) {
      onRequest(requestFrom(`10.0.0.${i}`), h)
    }

    expect(info).not.toHaveBeenCalled()
  })

  test('Should sweep aged-out clients once the tracking cap is passed', () => {
    const { onRequest } = registerPlugin()

    // One request each from more clients than the tracker will hold. Every entry
    // is inside the window, so nothing is swept yet.
    for (let i = 0; i <= MAX_TRACKED_CLIENTS; i += 1) {
      onRequest(requestFrom(`10.1.${Math.floor(i / 256)}.${i % 256}`), h)
    }

    // Age them all out, then trip the cap again: the sweep now has expired
    // entries to drop, which is the branch that bounds the map's growth.
    vi.advanceTimersByTime(WINDOW_MS + 1)
    for (let i = 0; i <= MAX_TRACKED_CLIENTS; i += 1) {
      onRequest(requestFrom(`10.2.${Math.floor(i / 256)}.${i % 256}`), h)
    }

    // Still purely observational: no request was ever rejected.
    expect(onRequest(requestFrom('10.3.0.1'), h)).toBe(h.continue)
  })

  test('Should fall back to a placeholder when the client IP is unknown', () => {
    const { onRequest, info } = registerPlugin()
    const anonymous = { info: {}, path: '/health', method: 'get' }

    for (let i = 0; i <= BURST_THRESHOLD; i += 1) {
      onRequest(anonymous, h)
    }

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: 'unknown' }),
      'perf-evidence: no-rate-limit'
    )
  })
})
