import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real module talks to its parent thread. Standing in for parentPort lets
// the message contract be tested directly — v8 coverage cannot see across a
// thread boundary, so exercising it through a live Worker proves it runs but
// measures nothing.
const handlers = new Map()
const postMessage = vi.fn()

vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: (event, handler) => handlers.set(event, handler),
    postMessage: (...args) => postMessage(...args)
  }
}))

await import('./parse-worker.js')

const { ERROR_CODES } = await import('../../validation/geopackage/errors.js')
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

/** Deliver a message to the worker exactly as the parent thread would. */
function sendToWorker(buffer) {
  handlers.get('message')({ buffer })
  return postMessage.mock.calls.at(-1)[0]
}

beforeEach(() => {
  postMessage.mockClear()
})

describe('parse-worker message handling', () => {
  it('subscribes to messages from the parent thread', () => {
    expect(handlers.has('message')).toBe(true)
  })

  it('posts back the gate result and layers for a valid file', () => {
    const reply = sendToWorker(fullReadBuffer())

    expect(reply.ok).toBe(true)
    expect(reply.valid).toBe(true)
    expect(reply.layers).not.toBeNull()
  })

  it('posts back the rejection for a file that is not a GeoPackage', () => {
    const reply = sendToWorker(Buffer.from('not a database'))

    expect(reply.ok).toBe(true)
    expect(reply.valid).toBe(false)
    expect(reply.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.GPKG_INVALID_FILE
    ])
  })

  it('reports a thrown parse error as a message rather than letting it escape', () => {
    // An uncaught throw here would kill the thread and surface as an opaque
    // exit code; the dispatcher needs the reason.
    const reply = sendToWorker(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [wrapGpkgWkb(readTestPolygonWkb(), EPSG_WEB_MERCATOR)]
        }
      })
    )

    expect(reply.ok).toBe(false)
    expect(reply.message).toMatch(/Unsupported SRID/)
    expect(reply.name).toBeTypeOf('string')
  })

  it('rebuilds the buffer from a plain structured-clone view', () => {
    // postMessage hands the other side a Uint8Array view, not a Buffer.
    const source = fullReadBuffer()
    const view = new Uint8Array(source)

    const reply = sendToWorker(view)

    expect(reply.ok).toBe(true)
    expect(reply.valid).toBe(true)
  })
})
