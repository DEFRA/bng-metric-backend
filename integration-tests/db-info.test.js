import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, stopServer } from './helpers/server.js'

const HTTP_OK = 200

describe('GET /db-info', () => {
  let server

  beforeAll(async () => {
    server = await startServer()
  })

  afterAll(async () => {
    await stopServer(server)
  })

  it('returns the PostgreSQL version', async () => {
    const res = await server.inject({ method: 'GET', url: '/db-info' })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.version).toMatch(/PostgreSQL/)
  })
})
