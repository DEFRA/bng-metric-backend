import { describe, expect, it } from 'vitest'

import { parseWkt } from './parse-wkt.js'

/** Milliseconds. Generous: the reader takes about 0.1 s for 1 MB. */
const LARGE_TEXT_TIME_LIMIT_MS = 2000

/** More positions than a spread argument list can hold in V8. */
const MANY_VERTICES = 200_000

/** `n` zigzag positions as WKT, 1 m apart in x. */
function zigzagPositions(n) {
  return Array.from({ length: n }, (_, i) => `${i} ${i % 2}`).join(', ')
}

describe('parseWkt', () => {
  it('reads the six simple feature types in any case', () => {
    expect(parseWkt('Point (20 450)')).toEqual({
      type: 'Point',
      coordinates: [20, 450]
    })
    expect(parseWkt('LINESTRING (0 0, 10 0)')).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [10, 0]
      ]
    })
    expect(parseWkt('polygon ((0 0, 1 0, 1 1, 0 0))')).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0]
        ]
      ]
    })
    expect(parseWkt('MultiLineString ((0 0, 1 0), (5 5, 6 5))')).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [1, 0]
        ],
        [
          [5, 5],
          [6, 5]
        ]
      ]
    })
    expect(
      parseWkt('MultiPolygon (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))')
        .coordinates
    ).toHaveLength(2)
  })

  it('reads MultiPoint members with and without brackets', () => {
    const expected = {
      type: 'MultiPoint',
      coordinates: [
        [1, 2],
        [3, 4]
      ]
    }
    expect(parseWkt('MultiPoint ((1 2), (3 4))')).toEqual(expected)
    expect(parseWkt('MULTIPOINT (1 2, 3 4)')).toEqual(expected)
  })

  it('reads Z and M ordinates, however the dimension is written', () => {
    const expected = { type: 'Point', coordinates: [1, 2, 3] }
    expect(parseWkt('PointZ (1 2 3)')).toEqual(expected)
    expect(parseWkt('POINT Z (1 2 3)')).toEqual(expected)
    expect(parseWkt('LineString ZM (0 0 1 2, 1 0 1 2)').coordinates).toEqual([
      [0, 0, 1, 2],
      [1, 0, 1, 2]
    ])
  })

  it('reads every number form a writer can produce', () => {
    expect(parseWkt('POINT (-0.5 +1.)').coordinates).toEqual([-0.5, 1])
    expect(parseWkt('POINT (.25 1e3)').coordinates).toEqual([0.25, 1000])
    expect(parseWkt('POINT(467485.486\t227720.938)').coordinates).toEqual([
      467485.486, 227720.938
    ])
  })

  it('gives empty coordinates for an EMPTY geometry', () => {
    expect(parseWkt('Polygon EMPTY')).toEqual({
      type: 'Polygon',
      coordinates: []
    })
    expect(parseWkt('POINT Z EMPTY')).toEqual({
      type: 'Point',
      coordinates: []
    })
  })

  it('returns null for anything that is not one whole simple geometry', () => {
    for (const text of [
      '',
      'garbage',
      'POINT (1 2) garbage',
      'POINT (1 2), POINT (3 4)',
      'Point (NaN 1)',
      'Point (1)',
      'Point (1 2 3 4 5)',
      'Point (1 2',
      'LineString ()',
      'LineString (1 2,)',
      'LineString (1 2 , , 3 4)',
      'Polygon ((0 0, 100 0',
      'Polygon (0 0, 1 0, 1 1, 0 0)',
      'MultiPoint (EMPTY, (1 2))',
      'Point EMPTY (1 2)',
      'Point FOO (1 2)',
      'SRID=27700;POINT (1 2)',
      'GeometryCollection (Point (1 2))',
      'CircularString (0 0, 1 1, 2 0)',
      'CurvePolygon ((0 0, 100 0, 100 100, 0 0))'
    ]) {
      expect(parseWkt(text)).toBeNull()
    }
  })

  it('reads a line too long for a spread argument list', () => {
    const text = `LineString (${zigzagPositions(MANY_VERTICES)})`

    const geometry = parseWkt(text)

    expect(geometry.coordinates).toHaveLength(MANY_VERTICES)
    expect(geometry.coordinates.at(-1)).toEqual([MANY_VERTICES - 1, 1])
  })

  it('reads a 4 MB text in bounded time', () => {
    // A reader that rescans the rest of the text for every coordinate takes
    // tens of seconds on this; this one is linear.
    const text = `LineString (${'1 1, '.repeat(800_000)}2 2)`

    const started = performance.now()
    const geometry = parseWkt(text)
    const elapsed = performance.now() - started

    expect(geometry.coordinates).toHaveLength(800_001)
    expect(elapsed).toBeLessThan(LARGE_TEXT_TIME_LIMIT_MS)
  })
})
