import { describe, expect, it } from 'vitest'

import { loadGeosRuntime } from './geos-runtime.js'
import { bbox, candidatePairs, freeLayers, loadLayer } from './geometry.js'
import { polygon, square, X0, Y0 } from './test-fixtures.js'

const runtime = await loadGeosRuntime()

describe('bbox', () => {
  it('bounds a polygon ring', () => {
    expect(bbox({ type: 'Polygon', coordinates: [square()] })).toEqual([
      X0,
      Y0,
      X0 + 100,
      Y0 + 100
    ])
  })

  it('bounds a bare position', () => {
    expect(bbox({ type: 'Point', coordinates: [1, 2] })).toEqual([1, 2, 1, 2])
  })

  it('bounds every ring of a multipolygon, not just the first', () => {
    expect(
      bbox({
        type: 'MultiPolygon',
        coordinates: [[square(0, 0, 10)], [square(100, 100, 10)]]
      })
    ).toEqual([0, 0, 110, 110])
  })
})

describe('candidatePairs', () => {
  it('reports boxes that overlap', () => {
    expect(
      candidatePairs([
        [0, 0, 10, 10],
        [5, 5, 15, 15]
      ])
    ).toEqual([[0, 1]])
  })

  it('reports boxes that only touch — a shared edge is a candidate', () => {
    expect(
      candidatePairs([
        [0, 0, 10, 10],
        [10, 0, 20, 10]
      ])
    ).toEqual([[0, 1]])
  })

  it('ignores boxes separated in x', () => {
    expect(
      candidatePairs([
        [0, 0, 10, 10],
        [100, 0, 110, 10]
      ])
    ).toEqual([])
  })

  it('ignores boxes that overlap in x but not in y', () => {
    expect(
      candidatePairs([
        [0, 0, 10, 10],
        [5, 100, 15, 110]
      ])
    ).toEqual([])
  })

  it('always reports the lower index first, whatever the sweep order', () => {
    // Box 1 starts left of box 0, so the sweep reaches it first.
    for (const [a, b] of candidatePairs([
      [50, 0, 100, 10],
      [0, 0, 60, 10]
    ])) {
      expect(a).toBeLessThan(b)
    }
  })

  it('agrees with the naive all-pairs comparison over a grid of boxes', () => {
    const boxes = []
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        boxes.push([x * 9, y * 9, x * 9 + 10, y * 9 + 10])
      }
    }
    const naive = []
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const overlap =
          boxes[a][0] <= boxes[b][2] &&
          boxes[a][2] >= boxes[b][0] &&
          boxes[a][1] <= boxes[b][3] &&
          boxes[a][3] >= boxes[b][1]
        if (overlap) {
          naive.push(`${a}-${b}`)
        }
      }
    }
    const swept = candidatePairs(boxes)
      .map(([a, b]) => `${a}-${b}`)
      .sort()
    expect(swept).toEqual(naive.sort())
  })

  it('handles an empty layer', () => {
    expect(candidatePairs([])).toEqual([])
  })
})

describe('loadLayer', () => {
  it('keeps the array position as idx, so a feature without geometry does not shift its neighbours', () => {
    const features = [
      polygon(square(), { fid: 1 }),
      { type: 'Feature', properties: { fid: 2 }, nativeGeometry: null },
      polygon(square(), { fid: 3 })
    ]
    const loaded = loadLayer(features, runtime)
    try {
      expect(loaded.map((f) => f.idx)).toEqual([0, 2])
      expect(loaded.map((f) => f.fid)).toEqual(['1', '3'])
    } finally {
      freeLayers({ areas: loaded }, runtime)
    }
  })

  it('stringifies a numeric fid, matching the SQL engine props->>fid', () => {
    const loaded = loadLayer([polygon(square(), { fid: 42 })], runtime)
    try {
      expect(loaded[0].fid).toBe('42')
    } finally {
      freeLayers({ areas: loaded }, runtime)
    }
  })

  it('reports no fid when the property is absent', () => {
    const loaded = loadLayer([polygon(square(), {})], runtime)
    try {
      expect(loaded[0].fid).toBeNull()
      expect(loaded[0].featureRef).toBeNull()
    } finally {
      freeLayers({ areas: loaded }, runtime)
    }
  })

  it.each([
    ['Parcel Ref', 'H001'],
    ['Tree Ref', 'T001'],
    ['Baseline Parcel Ref', 'B001']
  ])('resolves %s as the feature ref', (property, value) => {
    const loaded = loadLayer(
      [polygon(square(), { [property]: value })],
      runtime
    )
    try {
      expect(loaded[0].featureRef).toBe(value)
    } finally {
      freeLayers({ areas: loaded }, runtime)
    }
  })

  it('prefers Parcel Ref when a feature carries more than one reference column', () => {
    const loaded = loadLayer(
      [polygon(square(), { 'Parcel Ref': 'H001', 'Tree Ref': 'T001' })],
      runtime
    )
    try {
      expect(loaded[0].featureRef).toBe('H001')
    } finally {
      freeLayers({ areas: loaded }, runtime)
    }
  })

  it('reprojects a WGS84 feature into British National Grid before loading it', () => {
    const loaded = loadLayer(
      [
        polygon(
          [
            [-0.72, 51.52],
            [-0.71, 51.52],
            [-0.71, 51.53],
            [-0.72, 51.52]
          ],
          {},
          4326
        )
      ],
      runtime
    )
    try {
      expect(loaded[0].bbox[0]).toBeCloseTo(488_906.998, 2)
      expect(runtime.area(loaded[0].geom)).toBeGreaterThan(100_000)
    } finally {
      freeLayers({ areas: loaded }, runtime)
    }
  })

  it('treats a missing layer as empty', () => {
    expect(loadLayer(undefined, runtime)).toEqual([])
  })
})
