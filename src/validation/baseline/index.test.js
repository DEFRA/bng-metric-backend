import { describe, it, expect } from 'vitest'
import { validateBaselineLayers } from './index.js'

function poly(coords, props = {}) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [coords] },
    nativeGeometry: { type: 'Polygon', coordinates: [coords] },
    nativeSrid: 27700
  }
}

// Simple square redline + a habitat that exactly fills it. Coordinates are
// chosen to land inside the placeholder England polygon (around London) and
// well under 100 sq km in planar terms.
const BBOX_W = -0.2
const BBOX_E = -0.19
const BBOX_S = 51.5
const BBOX_N = 51.51

const redlineRing = [
  [BBOX_W, BBOX_S],
  [BBOX_E, BBOX_S],
  [BBOX_E, BBOX_N],
  [BBOX_W, BBOX_N],
  [BBOX_W, BBOX_S]
]

describe('validateBaselineLayers', () => {
  it('returns valid for a clean baseline', async () => {
    const layers = {
      redline: [poly(redlineRing)],
      areas: [poly(redlineRing)],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: []
    }
    const result = await validateBaselineLayers(layers)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('aggregates a NO_HABITAT_AREAS error when no habitats are present', async () => {
    const layers = {
      redline: [poly(redlineRing)],
      areas: [],
      hedgerows: [],
      watercourses: [],
      iggis: [],
      trees: []
    }
    const result = await validateBaselineLayers(layers)
    expect(result.valid).toBe(false)
    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('NO_HABITAT_AREAS')
  })
})
