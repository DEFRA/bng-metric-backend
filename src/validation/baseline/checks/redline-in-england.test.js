import { describe, it, expect } from 'vitest'
import { redlineInEngland } from './redline-in-england.js'

const LONDON_W = -0.2
const LONDON_E = -0.05
const LONDON_S = 51.45
const LONDON_N = 51.55
const FRANCE_W = 2
const FRANCE_E = 2.5
const FRANCE_S = 48
const FRANCE_N = 48.5

function poly(coords) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] }
  }
}

describe('redlineInEngland', () => {
  it('returns null when redline sits inside England (London)', () => {
    const london = poly([
      [LONDON_W, LONDON_S],
      [LONDON_E, LONDON_S],
      [LONDON_E, LONDON_N],
      [LONDON_W, LONDON_N],
      [LONDON_W, LONDON_S]
    ])
    expect(redlineInEngland([london])).toBeNull()
  })

  it('returns an error when redline sits in France', () => {
    const france = poly([
      [FRANCE_W, FRANCE_S],
      [FRANCE_E, FRANCE_S],
      [FRANCE_E, FRANCE_N],
      [FRANCE_W, FRANCE_N],
      [FRANCE_W, FRANCE_S]
    ])
    const err = redlineInEngland([france])
    expect(err).not.toBeNull()
    expect(err.code).toBe('REDLINE_OUTSIDE_ENGLAND')
  })

  it('returns null when redline list is empty', () => {
    expect(redlineInEngland([])).toBeNull()
  })
})
