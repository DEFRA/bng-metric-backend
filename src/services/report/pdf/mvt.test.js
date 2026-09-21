/**
 * The vector-tile adapter.
 *
 * `@mapbox/vector-tile` does the format work and is not retested here. What
 * these cover is the layer either side of it: that a tile written the way
 * Ordnance Survey writes one comes back in the shape `map.js` draws from, and
 * that the one normalisation this module applies — opening closed polygon
 * rings — actually happens. Encode and decode are exercised against each
 * other, so a bug has to exist in BOTH directions in a mutually-cancelling way
 * to slip through.
 */

import { describe, expect, test } from 'vitest'

import {
  DEFAULT_EXTENT,
  GEOMETRY_LINE,
  GEOMETRY_POINT,
  GEOMETRY_POLYGON,
  decodeVectorTile
} from './mvt.js'
import { encodeVectorTile } from './vector-tile-writer.test-fixtures.js'

describe('#decodeVectorTile', () => {
  test('a polygon with a hole round-trips', () => {
    const outer = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100]
    ]
    const hole = [
      [25, 25],
      [25, 75],
      [75, 75],
      [75, 25]
    ]

    const tile = decodeVectorTile(
      encodeVectorTile([
        {
          name: 'Test',
          features: [
            { type: GEOMETRY_POLYGON, properties: {}, paths: [outer, hole] }
          ]
        }
      ])
    )

    const layer = tile.layers.Test
    expect(layer.extent).toBe(DEFAULT_EXTENT)
    expect(layer.features[0].paths).toEqual([outer, hole])
    expect(layer.features[0].type).toBe(GEOMETRY_POLYGON)
  })

  test('lines, points and negative coordinates round-trip', () => {
    // Negative coordinates are legal (the buffer outside a tile's edge) and
    // are where a zigzag bug would show.
    const line = [
      [-64, 10],
      [200, -30],
      [4096, 4200]
    ]
    const points = [
      [-5, -5],
      [10, 20]
    ]

    const tile = decodeVectorTile(
      encodeVectorTile([
        {
          name: 'Lines',
          features: [{ type: GEOMETRY_LINE, properties: {}, paths: [line] }]
        },
        {
          name: 'Points',
          features: [
            {
              type: GEOMETRY_POINT,
              properties: {},
              paths: points.map((point) => [point])
            }
          ]
        }
      ])
    )

    expect(tile.layers.Lines.features[0].paths).toEqual([line])
    expect(tile.layers.Points.features[0].paths).toEqual(
      points.map((point) => [point])
    )
  })

  test('properties of every value type round-trip', () => {
    const properties = {
      _symbol: 13,
      _name: 'Thames Path',
      negative: -42,
      fraction: 2.5,
      flag: true
    }

    const tile = decodeVectorTile(
      encodeVectorTile([
        {
          name: 'Props',
          features: [
            { type: GEOMETRY_POINT, properties, paths: [[[1, 2]]] },
            // A second feature sharing keys and values exercises the
            // layer's shared string pools.
            {
              type: GEOMETRY_POINT,
              properties: { _symbol: 13, other: 'x' },
              paths: [[[3, 4]]]
            }
          ]
        }
      ])
    )

    const [first, second] = tile.layers.Props.features
    expect(first.properties).toEqual(properties)
    expect(second.properties).toEqual({ _symbol: 13, other: 'x' })
  })

  test('multiple features and layers keep their order', () => {
    const tile = decodeVectorTile(
      encodeVectorTile([
        {
          name: 'A',
          features: [
            {
              type: GEOMETRY_LINE,
              properties: { _symbol: 0 },
              paths: [
                [
                  [0, 0],
                  [1, 1]
                ]
              ]
            },
            {
              type: GEOMETRY_LINE,
              properties: { _symbol: 1 },
              paths: [
                [
                  [2, 2],
                  [3, 3]
                ]
              ]
            }
          ]
        },
        {
          name: 'B',
          features: [
            { type: GEOMETRY_POINT, properties: {}, paths: [[[9, 9]]] }
          ]
        }
      ])
    )

    expect(Object.keys(tile.layers)).toEqual(['A', 'B'])
    expect(tile.layers.A.features[0].properties._symbol).toBe(0)
    expect(tile.layers.A.features[1].properties._symbol).toBe(1)
  })
})

describe('closing vertices', () => {
  test('a polygon ring comes back OPEN, however it was written', () => {
    // On the wire a ring is closed: ClosePath, and the encoder writes the
    // first vertex again if the caller has not. `map.js` closes its own
    // paths, so a repeated vertex here would add a zero-length segment to
    // every ring of every basemap polygon.
    const closed = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0]
    ]

    const tile = decodeVectorTile(
      encodeVectorTile([
        {
          name: 'Closed',
          features: [
            { type: GEOMETRY_POLYGON, properties: {}, paths: [closed] }
          ]
        }
      ])
    )

    expect(tile.layers.Closed.features[0].paths).toEqual([closed.slice(0, -1)])
  })

  test('a line is left exactly as written, first vertex repeated or not', () => {
    // A closed LINE is a legitimate shape — a roundabout, a field boundary
    // drawn as a line — and dropping its last vertex would open it.
    const ring = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 0]
    ]

    const tile = decodeVectorTile(
      encodeVectorTile([
        {
          name: 'Lines',
          features: [{ type: GEOMETRY_LINE, properties: {}, paths: [ring] }]
        }
      ])
    )

    expect(tile.layers.Lines.features[0].paths).toEqual([ring])
  })
})
