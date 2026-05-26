import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startServer, stopServer } from './helpers/server.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400

let server

beforeAll(async () => {
  server = await startServer()
})

afterAll(async () => {
  await stopServer(server)
})

describe('GET /reference/broad-habitats', () => {
  it('returns the alphabetised list of broad habitats for area habitats', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/broad-habitats'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(Array.isArray(res.result)).toBe(true)
    expect(res.result).toContain('Cropland')
    expect(res.result).toContain('Grassland')
    expect(res.result).not.toContain('Wetland')
  })
})

describe('GET /reference/habitat-types', () => {
  it('returns habitat types with distinctiveness band and score', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/habitat-types?broad=Cropland'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.map((t) => t.name)).toContain('Cereal crops')
    res.result.forEach((entry) => {
      expect(entry).toHaveProperty('name')
      expect(entry).toHaveProperty('distinctiveness')
      expect(entry).toHaveProperty('distinctivenessScore')
    })
  })

  it('returns 400 when broad query param is missing', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/habitat-types'
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})

describe('GET /reference/conditions', () => {
  it('returns the five-band condition list for a grassland habitat type', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/conditions?habitatType=Grassland%20-%20Modified%20grassland'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.map((c) => c.condition)).toEqual([
      'Good',
      'Fairly Good',
      'Moderate',
      'Fairly Poor',
      'Poor'
    ])
  })

  it('returns 400 when habitatType query param is missing', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/conditions'
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })
})

describe('GET /reference/trading-rules', () => {
  it('returns the trading-rules map keyed by distinctiveness band', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/trading-rules'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(Object.keys(res.result).sort()).toEqual(
      ['High', 'Low', 'Medium', 'V.High', 'V.Low'].sort()
    )
  })
})
