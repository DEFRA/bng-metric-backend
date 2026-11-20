import { describe, expect, it } from 'vitest'

import { toBritishNationalGrid } from '../../geos/reproject.js'
import { interiorPoint, liesWithinParent } from './within-parent.js'

const X = 530_000
const Y = 180_000

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

// A U open to the north: its centroid falls in the gap between its arms.
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

describe('interiorPoint', () => {
  it('finds a point inside a concave polygon whose centroid is outside it', () => {
    const [x, y] = interiorPoint([U_SHAPE])

    expect(y).toBeGreaterThan(Y + 10)
    expect(x < X + 10 || x > X + 20).toBe(true)
  })

  it('finds a point clear of a hole over the centroid', () => {
    const [x] = interiorPoint([square(X, Y, 30), square(X + 5, Y + 5, 20)])

    expect(x < X + 5 || x > X + 25).toBe(true)
  })

  it('finds none in a polygon with no area', () => {
    expect(
      interiorPoint([
        [
          [X, Y],
          [X + 10, Y],
          [X, Y]
        ]
      ])
    ).toBeNull()
  })
})

describe('liesWithinParent', () => {
  const parent = feature([square(X, Y, 100)])

  it('is true for a concave part of the parent', () => {
    expect(liesWithinParent(feature([U_SHAPE]), parent)).toBe(true)
  })

  it('is false for a row beside the parent', () => {
    expect(liesWithinParent(feature([square(X + 100, Y, 100)]), parent)).toBe(
      false
    )
  })

  it('is false for a row in a hole of the parent', () => {
    const holed = feature([square(X, Y, 100), square(X + 40, Y + 40, 20)])

    expect(liesWithinParent(feature([square(X + 45, Y + 45, 10)]), holed)).toBe(
      false
    )
  })

  it('is true for a row in any part of a multi-part parent', () => {
    const parts = feature(
      [[square(X, Y, 10)], [square(X + 50, Y, 10)]],
      'MultiPolygon'
    )

    expect(liesWithinParent(feature([square(X + 52, Y + 2, 5)]), parts)).toBe(
      true
    )
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

    expect(liesWithinParent(row, around(0))).toBe(true)
    expect(liesWithinParent(row, around(500))).toBe(false)
  })

  it('takes a row or parent with no readable shape to lie within', () => {
    expect(liesWithinParent({}, parent)).toBe(true)
    expect(liesWithinParent(feature([U_SHAPE]), {})).toBe(true)
    expect(liesWithinParent(feature([[X, Y]], 'Point'), parent)).toBe(true)
  })
})
