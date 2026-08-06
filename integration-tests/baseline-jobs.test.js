import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'
import { HTTP_NOT_FOUND } from './helpers/http-status.js'

const HTTP_SERVICE_UNAVAILABLE = 503

// Covers the async validation routes. The worker is off by default
// (ASYNC_VALIDATION_ENABLED unset), so the enqueue routes report 503 and the
// synchronous /baseline/validate path remains the only validation route. The
// full async round-trip (enqueue -> worker -> poll) is exercised separately with
// the worker enabled; here we pin the disabled-by-default contract and the
// job-status lookup.
describe('async baseline validation routes', () => {
  let server
  let headers

  beforeAll(async () => {
    server = await startServer()
    headers = authHeaders(await mintToken({ sub: `it-${randomUUID()}` }))
  })

  afterAll(async () => {
    await stopServer(server)
  })

  it('enqueue baseline returns 503 when the async worker is disabled', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/baseline/validate-async/${randomUUID()}`,
      headers,
      payload: {}
    })
    expect(res.statusCode).toBe(HTTP_SERVICE_UNAVAILABLE)
  })

  it('enqueue post-intervention returns 503 when the async worker is disabled', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/post-intervention/validate-async/${randomUUID()}`,
      headers,
      payload: {}
    })
    expect(res.statusCode).toBe(HTTP_SERVICE_UNAVAILABLE)
  })

  it('job status returns 404 for an unknown job id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/baseline/jobs/${randomUUID()}`,
      headers
    })
    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })
})
