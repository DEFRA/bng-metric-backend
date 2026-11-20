import { afterEach, describe, expect, it } from 'vitest'

import { loadGeosRuntime } from '../../geos/geos-runtime.js'
import { toBritishNationalGrid } from '../../geos/reproject.js'
import { createWithinParentCheck } from './within-parent.js'

const X = 530_000
const Y = 180_000

const runtime = await loadGeosRuntime()

const square = (x0, y0, side) => [
  [x0, y0],
  [x0 + side, y0],
  [x0 + side, y0 + side],
  [x0, y0 + side],
  [x0, y0]
]

const feature = (coordinates, type = 'Polygon', nativeSrid = 27_700) => ({
  nativeGeometry: { type, coordinates },
  nativeSrid
})

// A U open to the north, inside the 100 m parent below.
const U_SHAPE = [
  [X, Y],
  [X + 30, Y],
  [X + 30, Y + 30],
  [X + 20, Y + 30],
  [X + 20, Y + 10],
  [X + 10, Y + 10],
  [X + 10, Y + 30],
  [X, Y + 30],
  [X, Y]
]

describe('createWithinParentCheck', () => {
  const parent = feature([square(X, Y, 100)])
  let check

  const liesWithin = (row, of = parent) => {
    check?.free()
    check = createWithinParentCheck(runtime)
    return check.liesWithinParent(row, of)
  }

  afterEach(() => {
    check?.free()
    check = null
  })

  it('passes the parent itself and a concave part of it', () => {
    expect(liesWithin(feature([square(X, Y, 100)]))).toBe(true)
    expect(liesWithin(feature([U_SHAPE]))).toBe(true)
  })

  it('refuses a row beside the parent', () => {
    expect(liesWithin(feature([square(X + 100, Y, 100)]))).toBe(false)
  })

  it('refuses a row that covers the parent and spills into the land beside it', () => {
    expect(liesWithin(feature([square(X, Y, 140)]))).toBe(false)
  })

  it('passes a row no more than 0.5 m² of which lies outside, as the red line does', () => {
    const stray = (width) => [
      [X, Y],
      [X + 100 + width, Y],
      [X + 100 + width, Y + 100],
      [X, Y + 100],
      [X, Y]
    ]

    expect(liesWithin(feature([stray(0.004)]))).toBe(true)
    expect(liesWithin(feature([stray(0.006)]))).toBe(false)
  })

  it('refuses a row in a hole of the parent', () => {
    const holed = feature([square(X, Y, 100), square(X + 40, Y + 40, 20)])

    expect(liesWithin(feature([square(X + 45, Y + 45, 10)]), holed)).toBe(false)
  })

  it('passes a row in any part of a multi-part parent, and refuses one across the gap', () => {
    const parts = feature(
      [[square(X, Y, 10)], [square(X + 50, Y, 10)]],
      'MultiPolygon'
    )
    const acrossTheGap = [
      [X + 5, Y + 2],
      [X + 55, Y + 2],
      [X + 55, Y + 7],
      [X + 5, Y + 7],
      [X + 5, Y + 2]
    ]

    expect(liesWithin(feature([square(X + 52, Y + 2, 5)]), parts)).toBe(true)
    expect(liesWithin(feature([acrossTheGap]), parts)).toBe(false)
  })

  it('compares a WGS84 row with a British National Grid parent in one grid', () => {
    // A square of some 10 m near the Greenwich meridian.
    const wgs84 = [
      [-0.00137, 51.47746],
      [-0.00123, 51.47746],
      [-0.00123, 51.47755],
      [-0.00137, 51.47755],
      [-0.00137, 51.47746]
    ]
    const row = feature([wgs84], 'Polygon', 4326)
    const [[[x, y]]] = toBritishNationalGrid(
      row.nativeGeometry,
      4326
    ).coordinates
    const around = (dx) => feature([square(x - 50 + dx, y - 50, 200)])

    expect(liesWithin(row, around(0))).toBe(true)
    expect(liesWithin(row, around(500))).toBe(false)
  })

  it('takes a row or parent with no polygonal shape to lie within', () => {
    expect(liesWithin({})).toBe(true)
    expect(liesWithin(feature([U_SHAPE]), {})).toBe(true)
    expect(liesWithin(feature([X, Y], 'Point'))).toBe(true)
  })

  it('loads each parent once, however many rows name it', () => {
    check = createWithinParentCheck(runtime)
    const prepare = runtime.geos.GEOSPrepare
    let prepared = 0
    runtime.geos.GEOSPrepare = (g) => {
      prepared += 1
      return prepare(g)
    }
    try {
      for (const x of [X, X + 50]) {
        expect(
          check.liesWithinParent(feature([square(x, Y, 50)]), parent)
        ).toBe(true)
      }
    } finally {
      runtime.geos.GEOSPrepare = prepare
    }

    expect(prepared).toBe(1)
  })
})
