import { describe, expect, it } from 'vitest'

import { freeLayers, loadLayer } from './geometry.js'
import { loadGeosRuntime } from './geos-runtime.js'
import { measureLayers } from './sizes.js'
import { line, polygon } from './test-fixtures.js'

const runtime = await loadGeosRuntime()

// Baseline parcel H001 and hedgerow HG001 of the harness's
// example-files/permutations/intervention/area-enhanced-baseline.gpkg: real
// British National Grid coordinates, where a careless area formula loses
// about five significant figures.
const H001 = [
  [530066.9373186704, 179556.3807426773],
  [530136.902344139, 179534.75631210193],
  [530408.2527507545, 179680.27897243464],
  [530444.5050301832, 179786.91852747035],
  [530109.2448720403, 180220.78137088363],
  [530066.9373186704, 179556.3807426773]
]
const HG001 = [
  [530025.3587009454, 180211.10748672587],
  [530055.2245340901, 180027.52660581493],
  [530045.4303503721, 179841.79028252096]
]

function load(layers) {
  return Object.fromEntries(
    Object.entries(layers).map(([name, features]) => [
      name,
      loadLayer(features, runtime)
    ])
  )
}

describe('measureLayers', () => {
  it('measures each area parcel and linear feature, keyed by its position', () => {
    const loaded = load({
      areas: [polygon(H001)],
      hedgerows: [line(HG001)],
      watercourses: []
    })
    try {
      expect(measureLayers(loaded)).toEqual({
        areas: [{ idx: 0, value: 144529.0811549303 }],
        hedgerows: [{ idx: 0, value: 371.98875157975516 }],
        watercourses: []
      })
    } finally {
      freeLayers(loaded, runtime)
    }
  })

  // Sizing moved from GEOS to bng-library/measure. Units are priced on these
  // sizes, so the move must not have changed any of them.
  it('gives exactly the sizes GEOS measured before the move', () => {
    const loaded = load({
      areas: [polygon(H001)],
      hedgerows: [line(HG001)]
    })
    try {
      const sizes = measureLayers(loaded)
      expect(sizes.areas[0].value).toBe(runtime.area(loaded.areas[0].valid))
      expect(sizes.hedgerows[0].value).toBe(
        runtime.length(loaded.hedgerows[0].valid)
      )
    } finally {
      freeLayers(loaded, runtime)
    }
  })

  it('measures nothing for a layer the file does not have', () => {
    expect(measureLayers({})).toEqual({
      areas: [],
      hedgerows: [],
      watercourses: []
    })
  })
})
