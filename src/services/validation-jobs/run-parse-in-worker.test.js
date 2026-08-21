import { describe, it, expect } from 'vitest'

import { runParseInWorker } from './run-parse-in-worker.js'
import { ERROR_CODES } from '../../validation/geopackage/errors.js'

const {
  ALL_LAYERS,
  GP10_APP_ID,
  LAYER_RLB,
  EPSG_WEB_MERCATOR,
  buildBuffer,
  fullReadBuffer,
  readTestPolygonWkb,
  wrapGpkgWkb
} = await import('../../../test/helpers/gpkg.js')

// Spinning up a real thread costs a few hundred ms; these run against one.
const WORKER_TIMEOUT_MS = 20_000

describe('runParseInWorker', () => {
  it(
    'parses a valid GeoPackage and returns its layers',
    async () => {
      const result = await runParseInWorker(fullReadBuffer())

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.layers).not.toBeNull()
      expect(result.layers.redline).toHaveLength(1)
    },
    WORKER_TIMEOUT_MS
  )

  it(
    'returns the gate rejection for a file that is not a GeoPackage',
    async () => {
      const result = await runParseInWorker(Buffer.from('not a database'))

      expect(result.valid).toBe(false)
      expect(result.layers).toBeNull()
      expect(result.errors.map((e) => e.code)).toEqual([
        ERROR_CODES.GPKG_INVALID_FILE
      ])
    },
    WORKER_TIMEOUT_MS
  )

  it(
    'rejects when the parse throws inside the worker',
    async () => {
      // An error thrown on another thread has to cross the boundary as a
      // rejection; losing it would leave the job hanging until the reaper.
      const buffer = buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [wrapGpkgWkb(readTestPolygonWkb(), EPSG_WEB_MERCATOR)]
        }
      })

      await expect(runParseInWorker(buffer)).rejects.toThrow(/Unsupported SRID/)
    },
    WORKER_TIMEOUT_MS
  )

  it(
    'keeps the request loop responsive while it parses',
    async () => {
      // The whole point of the story. A heartbeat that keeps firing during the
      // parse is the evidence the work left this thread.
      const INTERVAL_MS = 10
      let ticks = 0
      const beat = setInterval(() => {
        ticks += 1
      }, INTERVAL_MS)

      try {
        await runParseInWorker(fullReadBuffer())
      } finally {
        clearInterval(beat)
      }

      expect(ticks).toBeGreaterThan(0)
    },
    WORKER_TIMEOUT_MS
  )

  it(
    'parses a buffer that is a view into a pooled ArrayBuffer',
    async () => {
      // Small Buffers are slices of Node's shared pool. Transferring one would
      // detach unrelated buffers, so this path must copy instead.
      const pooled = Buffer.from(fullReadBuffer())
      const result = await runParseInWorker(pooled)

      expect(result.valid).toBe(true)
    },
    WORKER_TIMEOUT_MS
  )
})
