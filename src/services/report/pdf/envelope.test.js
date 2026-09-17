import { describe, expect, test } from 'vitest'

import {
  envelopeOf,
  envelopeOfAll,
  isEmptyEnvelope,
  padEnvelope
} from './envelope.js'

const POLYGON = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 20],
      [30, 20],
      [30, 40],
      [10, 20]
    ]
  ]
}

describe('#envelopeOf', () => {
  test('walks a polygon whatever its nesting depth', () => {
    expect(envelopeOf(POLYGON)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 30,
      maxY: 40
    })
    expect(
      envelopeOf({ type: 'MultiPolygon', coordinates: [POLYGON.coordinates] })
    ).toEqual({ minX: 10, minY: 20, maxX: 30, maxY: 40 })
  })

  test('handles points and lines as readily as areas', () => {
    expect(envelopeOf({ type: 'Point', coordinates: [5, 6] })).toEqual({
      minX: 5,
      minY: 6,
      maxX: 5,
      maxY: 6
    })
    expect(
      envelopeOf({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [4, 8]
          ]
        ]
      })
    ).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 8 })
  })

  test('descends into a geometry collection', () => {
    const collection = {
      type: 'GeometryCollection',
      geometries: [POLYGON, { type: 'Point', coordinates: [100, 200] }]
    }

    expect(envelopeOf(collection)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 100,
      maxY: 200
    })
  })

  test('reports an empty envelope for nothing at all', () => {
    expect(isEmptyEnvelope(envelopeOf(null))).toBe(true)
    expect(isEmptyEnvelope(envelopeOfAll([]))).toBe(true)
  })
})

describe('#padEnvelope', () => {
  test('grows by a fraction of the envelope on every side', () => {
    expect(
      padEnvelope({ minX: 0, minY: 0, maxX: 100, maxY: 200 }, 0.1)
    ).toEqual({ minX: -10, minY: -20, maxX: 110, maxY: 220 })
  })

  test('falls back to a fixed pad on a degenerate axis', () => {
    // A single point or a perfectly straight line has zero extent on an axis,
    // so a proportional pad would leave it degenerate and the page transform
    // would divide by zero.
    const padded = padEnvelope({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 0.1)

    expect(padded.maxX - padded.minX).toBeGreaterThan(0)
    expect(padded.maxY - padded.minY).toBeGreaterThan(0)
  })
})
