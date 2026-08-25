import { describe, test, expect, vi } from 'vitest'

import {
  logPerf,
  perfNow,
  msSince,
  microsSince,
  memoryUsageMb,
  utf8Bytes,
  PERF_EVIDENCE_MARKER
} from './perf-evidence.js'
import { config } from '../../config.js'

describe('#perfEvidence', () => {
  describe('logPerf', () => {
    test('Should emit one line carrying the marker and the measured fields', () => {
      const info = vi.fn()

      logPerf({ info }, 'pipeline-inline', { elapsedMs: 42 })

      expect(info).toHaveBeenCalledWith(
        { [PERF_EVIDENCE_MARKER]: 'pipeline-inline', elapsedMs: 42 },
        'perf-evidence: pipeline-inline'
      )
    })

    test('Should default the fields to an empty object', () => {
      const info = vi.fn()

      logPerf({ info }, 'no-rate-limit')

      expect(info).toHaveBeenCalledWith(
        { [PERF_EVIDENCE_MARKER]: 'no-rate-limit' },
        'perf-evidence: no-rate-limit'
      )
    })

    test('Should no-op when there is no logger in scope', () => {
      expect(() => logPerf(undefined, 'pipeline-inline')).not.toThrow()
    })

    test('Should no-op for a logger with no info method', () => {
      expect(() => logPerf({}, 'pipeline-inline')).not.toThrow()
    })

    test('Should emit nothing at all when the evidence flag is off', () => {
      const info = vi.fn()
      config.set('isPerfEvidenceEnabled', false)

      try {
        logPerf({ info }, 'pipeline-inline', { elapsedMs: 42 })
      } finally {
        config.set('isPerfEvidenceEnabled', true)
      }

      // One flag silences all 13 call sites, which is the point of routing
      // every one of them through this helper.
      expect(info).not.toHaveBeenCalled()
    })

    test('Should swallow a logger that throws rather than fail the caller', () => {
      const info = vi.fn(() => {
        throw new Error('transport closed')
      })

      // Evidence is emitted from inside the login transaction among other
      // places — a throw here would roll back work that had succeeded.
      expect(() =>
        logPerf({ info }, 'pipeline-inline', { ms: 1 })
      ).not.toThrow()
      expect(info).toHaveBeenCalled()
    })
  })

  describe('elapsed-time helpers', () => {
    test('Should return a monotonically non-decreasing clock', () => {
      const first = perfNow()
      const second = perfNow()

      expect(second).toBeGreaterThanOrEqual(first)
    })

    test('Should report whole milliseconds since a reading', () => {
      const elapsed = msSince(perfNow() - 25)

      expect(elapsed).toBeGreaterThanOrEqual(25)
      expect(Number.isInteger(elapsed)).toBe(true)
    })

    test('Should report whole microseconds since a reading', () => {
      const elapsed = microsSince(perfNow() - 2)

      expect(elapsed).toBeGreaterThanOrEqual(2000)
      expect(Number.isInteger(elapsed)).toBe(true)
    })
  })

  describe('memoryUsageMb', () => {
    test('Should report rss, heap, external and arrayBuffers in whole MB', () => {
      const usage = memoryUsageMb()

      expect(Object.keys(usage).sort()).toEqual([
        'arrayBuffersMb',
        'externalMb',
        'heapUsedMb',
        'rssMb'
      ])
      for (const value of Object.values(usage)) {
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
      }
    })

    test('Should track a large Buffer outside the heap, which heapUsed alone misses', () => {
      const before = memoryUsageMb()
      // Held in a variable so it cannot be collected before the second reading.
      const held = Buffer.alloc(64 * 1024 * 1024, 1)
      const after = memoryUsageMb()

      expect(held.byteLength).toBe(64 * 1024 * 1024)
      // This is the bug the helper exists to avoid: Buffer bytes live outside
      // the V8 heap, so external/arrayBuffers move where heapUsed need not.
      expect(
        after.arrayBuffersMb - before.arrayBuffersMb
      ).toBeGreaterThanOrEqual(32)
      expect(after.externalMb - before.externalMb).toBeGreaterThanOrEqual(32)
    })
  })

  describe('utf8Bytes', () => {
    test('Should measure UTF-8 length, not character count', () => {
      expect(utf8Bytes('abc')).toBe(3)
      expect(utf8Bytes('°')).toBe(2)
    })
  })
})
