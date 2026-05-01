import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, stopServer } from './helpers/server.js'

const HTTP_OK = 200

describe('GET /health', () => {
  let server

  beforeAll(async () => {
    server = await startServer()
  })

  afterAll(async () => {
    await stopServer(server)
  })

  it('returns 200 with success message', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ message: 'success' })
  })
})
