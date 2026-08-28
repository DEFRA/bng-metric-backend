/**
 * The hand-rolled MVT codec.
 *
 * Encode and decode are tested against each other, so a bug has to exist in
 * BOTH directions in a mutually-cancelling way to slip through — and the
 * decoder was additionally verified byte-for-byte against
 * @mapbox/vector-tile on a live 18-layer, 1,054-feature Ordnance Survey tile
 * during the spike.
 */

import { describe, expect, test } from 'vitest'

import {
  DEFAULT_EXTENT,
  GEOMETRY_LINE,
  GEOMETRY_POINT,
  GEOMETRY_POLYGON,
  decodeGeometry,
  decodeVectorTile,
  encodeVectorTile
} from './mvt.js'

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
            // A second feature sharing keys/values exercises the pools.
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

describe('#decodeGeometry', () => {
  test('handles the spec worked example', () => {
    // From the MVT 2.1 spec, section 4.3.5.2: a multi-line
    //   MoveTo(+2,+2), LineTo(+2,+2)  then  MoveTo(-3,-3), LineTo(+2,+2)
    const commands = [9, 4, 4, 10, 4, 4, 9, 5, 5, 10, 4, 4]
    expect(decodeGeometry(commands)).toEqual([
      [
        [2, 2],
        [4, 4]
      ],
      [
        [1, 1],
        [3, 3]
      ]
    ])
  })
})
