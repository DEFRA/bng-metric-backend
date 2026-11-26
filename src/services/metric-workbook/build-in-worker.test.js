import { describe, expect, test } from 'vitest'

import { zipEntries } from '../../../test/helpers/zip-entries.js'
import {
  MetricWorkbookBusyError,
  MetricWorkbookTimeoutError,
  buildMetricWorkbookInWorker,
  createWorkbookBuilder
} from './build-in-worker.js'

const STUB_WORKER = new URL('./build-in-worker.test-worker.js', import.meta.url)

const NOW = new Date('2026-11-26T10:00:00Z')
const SHORT_MS = 100
const TIMEOUT_MS = 1500
const SLOW_MS = 300
const SMALL_HEAP_MB = 16
// A real build takes a second or so; a slow CI runner gets room.
const REAL_BUILD_TIMEOUT_MS = 30_000
const TICK_MS = 10
// Building on the main thread stalls it for about a second. Off it, the
// longest stall seen was 25 ms; this leaves room for a loaded runner.
const MAX_MAIN_THREAD_STALL_MS = 250

function builder(overrides = {}) {
  return createWorkbookBuilder({
    concurrency: 1,
    queueWaitLimitMs: TIMEOUT_MS,
    timeoutMs: TIMEOUT_MS,
    maxHeapMb: 256,
    workerPath: STUB_WORKER,
    ...overrides
  })
}

const as = (behaviour, extra = {}) => ({
  name: 'Riverside',
  behaviour,
  ...extra
})

describe('createWorkbookBuilder', () => {
  test('returns the worker’s bytes as a Buffer, given the project, format and date', async () => {
    const workbook = await builder().build(as('echo'), {
      format: 'xlsx',
      now: NOW
    })

    expect(workbook).toBeInstanceOf(Buffer)
    expect(workbook.toString('utf8')).toBe(
      `xlsx|Riverside|${NOW.toISOString()}`
    )
  })

  test('fails with the error the worker reported, and its stack', async () => {
    const failure = builder().build(as('fail'), { format: 'xlsx' })

    await expect(failure).rejects.toThrow('too many rows')
    await expect(failure).rejects.toMatchObject({
      stack: expect.stringContaining('at worker')
    })
  })

  test('terminates a build that overruns its budget, and frees its slot', async () => {
    const workbooks = builder({ timeoutMs: SHORT_MS })

    await expect(
      workbooks.build(as('hang'), { format: 'xlsx' })
    ).rejects.toBeInstanceOf(MetricWorkbookTimeoutError)
    expect(workbooks.stats()).toEqual({ running: 0, waiting: 0 })
  })

  test('fails a build whose worker exits without replying', async () => {
    await expect(
      builder().build(as('exit'), { format: 'xlsx' })
    ).rejects.toThrow('Metric workbook worker exited with code 3')
  })

  test('stops a worker that outgrows its heap, not the process', async () => {
    const workbooks = builder({ maxHeapMb: SMALL_HEAP_MB })

    await expect(
      workbooks.build(as('heap'), { format: 'xlsx' })
    ).rejects.toMatchObject({ code: 'ERR_WORKER_OUT_OF_MEMORY' })
    expect(workbooks.stats()).toEqual({ running: 0, waiting: 0 })
  })

  test('runs no more builds at once than its concurrency, and queues the rest', async () => {
    const workbooks = builder()

    const first = workbooks.build(as('slow', { delayMs: SLOW_MS }), {
      format: 'xlsx',
      now: NOW
    })
    const second = workbooks.build(as('echo'), { format: 'xlsm', now: NOW })
    expect(workbooks.stats()).toEqual({ running: 1, waiting: 1 })

    const finished = []
    await Promise.all([
      first.then(() => finished.push('first')),
      second.then(() => finished.push('second'))
    ])
    expect(finished).toEqual(['first', 'second'])
    expect(workbooks.stats()).toEqual({ running: 0, waiting: 0 })
  })

  test('refuses a build that waits past the limit, without taking a slot', async () => {
    const workbooks = builder({ queueWaitLimitMs: SHORT_MS })

    const first = workbooks.build(as('slow', { delayMs: SLOW_MS }), {
      format: 'xlsx',
      now: NOW
    })
    await expect(
      workbooks.build(as('echo'), { format: 'xlsx' })
    ).rejects.toBeInstanceOf(MetricWorkbookBusyError)
    expect(workbooks.stats()).toEqual({ running: 1, waiting: 0 })

    await first
    expect(workbooks.stats()).toEqual({ running: 0, waiting: 0 })
    await expect(
      workbooks.build(as('echo'), { format: 'xlsx', now: NOW })
    ).resolves.toBeInstanceOf(Buffer)
  })
})

describe('buildMetricWorkbookInWorker', () => {
  test(
    'builds a real workbook while the main thread keeps answering',
    async () => {
      const project = {
        name: 'Riverside Farm',
        baseline: {
          habitats: [
            {
              featureId: 'b1',
              ref: 'H-TEST-1',
              broadType: 'Grassland',
              type: 'Modified grassland',
              condition: 'Poor',
              strategicSignificance: 'Low',
              sizeSquareMetres: 15_000
            }
          ]
        }
      }
      let last = performance.now()
      let longestStall = 0
      const ticker = setInterval(() => {
        const tick = performance.now()
        longestStall = Math.max(longestStall, tick - last)
        last = tick
      }, TICK_MS)

      try {
        const workbook = await buildMetricWorkbookInWorker(project, {
          format: 'xlsx'
        })
        const sheets = [...zipEntries(workbook).values()]
          .map((part) => part.toString('utf8'))
          .join('')

        expect(sheets).toContain('>H-TEST-1</t>')
        expect(sheets).toContain('>Riverside Farm</t>')
      } finally {
        clearInterval(ticker)
      }
      // A main thread blocked for the whole build never ticks at all, so the
      // stall still open when the build ends has to count too.
      longestStall = Math.max(longestStall, performance.now() - last)
      expect(longestStall).toBeLessThan(MAX_MAIN_THREAD_STALL_MS)
    },
    REAL_BUILD_TIMEOUT_MS
  )
})
