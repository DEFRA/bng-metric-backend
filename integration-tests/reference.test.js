import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startServer, stopServer } from './helpers/server.js'
import { HTTP_OK, HTTP_BAD_REQUEST } from './helpers/http-status.js'

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

describe('GET /reference/habitat-types-by-broad', () => {
  it('returns the full lookup grouped by broad with band + score per type', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/habitat-types-by-broad'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(typeof res.result).toBe('object')
    expect(res.result).toHaveProperty('Grassland')
    res.result.Grassland.forEach((entry) => {
      expect(entry).toHaveProperty('name')
      expect(entry).toHaveProperty('distinctiveness')
      expect(entry).toHaveProperty('distinctivenessScore')
    })
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

describe('GET /reference/hedgerow-types', () => {
  // Route-coverage check requires every manifest route to be hit, so this
  // smoke test stays even though the endpoint returns an empty array until
  // BMD-427/428 lands the hedgerow reference data. Full content assertions
  // (name / distinctiveness / distinctivenessScore) belong in that ticket.
  it('is reachable and returns a JSON array', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/hedgerow-types'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(Array.isArray(res.result)).toBe(true)
  })
})

describe('GET /reference/watercourse-types', () => {
  it('returns the watercourse types with distinctiveness band and score', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/watercourse-types'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.map((t) => t.name)).toContain('Priority habitat')
    res.result.forEach((entry) => {
      expect(entry).toHaveProperty('name')
      expect(entry).toHaveProperty('distinctiveness')
      expect(entry).toHaveProperty('distinctivenessScore')
    })
  })
})

describe('GET /reference/watercourse-encroachments', () => {
  it('returns both encroachment lists in one response', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reference/watercourse-encroachments'
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.watercourse).toContain('No Encroachment')
    expect(res.result.watercourse).toContain('N/A - Culvert')
    expect(res.result.riparian).toContain('No Encroachment/No Encroachment')
    expect(res.result.riparian).toContain('N/A - Culvert')
  })
})
