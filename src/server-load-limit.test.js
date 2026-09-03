import { afterEach, describe, expect, it } from 'vitest'
import Hapi from '@hapi/hapi'

/**
 * The memory backstop, tested against real @hapi/heavy rather than a stub.
 *
 * Worth pinning down for two reasons the config comment explains but code
 * cannot: the limit does nothing at all unless `sampleInterval` is also set
 * (heavy asserts on it), and the refusal has to be a 503 — the frontend's
 * upload path treats a 503 as "come back shortly" and anything else as a
 * problem with the user's file.
 */
describe('Hapi load limits — the memory backstop', () => {
  let server

  afterEach(async () => {
    await server?.stop()
  })

  async function serverWithLoad(load) {
    server = Hapi.server({ load })
    server.route({
      method: 'POST',
      path: '/validate',
      handler: () => ({ valid: true })
    })
    await server.initialize()
    return server
  }

  it('refuses with 503 once RSS is over the ceiling', async () => {
    // 1 byte: this process is unavoidably above it, so the limit always trips.
    await serverWithLoad({ maxRssBytes: 1, sampleInterval: 1 })
    // Give heavy one sampling tick to take a reading.
    await new Promise((resolve) => setTimeout(resolve, 20))

    const res = await server.inject({ method: 'POST', url: '/validate' })

    expect(res.statusCode).toBe(503)
  })

  it('serves normally when the ceiling is above actual usage', async () => {
    await serverWithLoad({
      maxRssBytes: 100 * 1024 * 1024 * 1024,
      sampleInterval: 1
    })

    const res = await server.inject({ method: 'POST', url: '/validate' })

    expect(res.statusCode).toBe(200)
  })

  it('serves normally when no limit is configured', async () => {
    await serverWithLoad({})

    const res = await server.inject({ method: 'POST', url: '/validate' })

    expect(res.statusCode).toBe(200)
  })

  // The trap: heavy throws at construction if a limit is set without an
  // interval. A config that silently did this would look enabled and protect
  // nothing, which is the failure mode this whole exercise started with.
  it('a limit without a sample interval is rejected, not silently ignored', () => {
    expect(() => Hapi.server({ load: { maxRssBytes: 1 } })).toThrow(
      /sample interval/i
    )
  })
})
