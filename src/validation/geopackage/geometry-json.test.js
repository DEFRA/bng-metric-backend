import { describe, it, expect } from 'vitest'

import { toGeometryJson } from './geometry-json.js'

const GEOMETRY = { type: 'Polygon', coordinates: [[[0, 0]]] }

describe('toGeometryJson', () => {
  it('returns the cached string without re-serialising the geometry', () => {
    // A geometry that would throw if stringified proves the cache is used and
    // JSON.stringify is never reached.
    const unserialisable = { type: 'Polygon' }
    unserialisable.self = unserialisable

    expect(toGeometryJson('{"cached":true}', unserialisable)).toBe(
      '{"cached":true}'
    )
  })

  it('falls back to serialising when there is no cached string', () => {
    expect(toGeometryJson(undefined, GEOMETRY)).toBe(JSON.stringify(GEOMETRY))
  })
})
