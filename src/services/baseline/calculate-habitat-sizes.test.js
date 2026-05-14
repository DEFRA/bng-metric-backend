import { describe, it, expect, vi } from 'vitest'

import {
  buildLayerArrays,
  calculateHabitatSizes,
  HABITAT_SIZE_LAYERS,
  CALCULATE_HABITAT_SIZES_QUERY
} from './calculate-habitat-sizes.js'

describe('HABITAT_SIZE_LAYERS', () => {
  it('includes only layers used by AC1 size calculations', () => {
    expect(HABITAT_SIZE_LAYERS).toEqual(['areas', 'hedgerows', 'watercourses'])
  })
})

describe('buildLayerArrays', () => {
  it('builds parallel arrays for areas, hedgerows and watercourses', () => {
    const layers = {
      areas: [
        {
          nativeGeometry: { type: 'Polygon', coordinates: [] },
          nativeSrid: 27700,
          properties: { fid: 1, 'Parcel Ref': 'A1' }
        }
      ],
      hedgerows: [
        {
          nativeGeometry: { type: 'LineString', coordinates: [] },
          nativeSrid: 4326,
          properties: { fid: 2, 'Parcel Ref': 'H1' }
        }
      ],
      watercourses: [
        {
          nativeGeometry: { type: 'LineString', coordinates: [] },
          nativeSrid: 4326,
          properties: { fid: 3, 'Baseline Parcel Ref': 'W1' }
        }
      ],
      trees: [
        {
          nativeGeometry: { type: 'Point', coordinates: [0, 0] },
          nativeSrid: 4326,
          properties: { fid: 4 }
        }
      ]
    }

    const result = buildLayerArrays(layers)

    expect(result.layerNames).toEqual(['areas', 'hedgerows', 'watercourses'])
    expect(result.idxs).toEqual([0, 0, 0])
    expect(result.srids).toEqual([27700, 4326, 4326])
    expect(result.props).toEqual([
      JSON.stringify({ fid: 1, 'Parcel Ref': 'A1' }),
      JSON.stringify({ fid: 2, 'Parcel Ref': 'H1' }),
      JSON.stringify({ fid: 3, 'Baseline Parcel Ref': 'W1' })
    ])
  })

  it('skips features without geometry', () => {
    const result = buildLayerArrays({
      areas: [{ nativeSrid: 27700, properties: { fid: 9 } }]
    })

    expect(result.layerNames).toEqual([])
    expect(result.idxs).toEqual([])
    expect(result.props).toEqual([])
    expect(result.geoms).toEqual([])
    expect(result.srids).toEqual([])
  })
})

describe('calculateHabitatSizes', () => {
  it('throws when pool is missing', async () => {
    await expect(calculateHabitatSizes(undefined, {})).rejects.toThrow(
      /requires a pg pool/
    )
  })

  it('returns empty shape when there are no calculable features', async () => {
    const pool = { query: vi.fn() }

    const result = await calculateHabitatSizes(pool, {
      areas: [],
      hedgerows: [],
      watercourses: []
    })

    expect(pool.query).not.toHaveBeenCalled()
    expect(result).toEqual({
      areaHabitats: { individualSquareMetres: [], totalSquareMetres: 0 },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    })
  })

  it('aggregates individual and total size values from query rows', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            layer: 'areas',
            idx: 0,
            fid: '10',
            feature_ref: 'A-10',
            size_value: '1.25'
          },
          {
            layer: 'areas',
            idx: 1,
            fid: '11',
            feature_ref: 'A-11',
            size_value: '0.75'
          },
          {
            layer: 'hedgerows',
            idx: 0,
            fid: '20',
            feature_ref: 'H-20',
            size_value: '0.5'
          },
          {
            layer: 'watercourses',
            idx: 0,
            fid: '30',
            feature_ref: 'W-30',
            size_value: '0.25'
          }
        ]
      })
    }

    const layers = {
      areas: [
        {
          nativeGeometry: { type: 'Polygon', coordinates: [] },
          nativeSrid: 27700,
          properties: { fid: 10, 'Parcel Ref': 'A-10' }
        },
        {
          nativeGeometry: { type: 'Polygon', coordinates: [] },
          nativeSrid: 27700,
          properties: { fid: 11, 'Parcel Ref': 'A-11' }
        }
      ],
      hedgerows: [
        {
          nativeGeometry: { type: 'LineString', coordinates: [] },
          nativeSrid: 4326,
          properties: { fid: 20, 'Parcel Ref': 'H-20' }
        }
      ],
      watercourses: [
        {
          nativeGeometry: { type: 'LineString', coordinates: [] },
          nativeSrid: 4326,
          properties: { fid: 30, 'Baseline Parcel Ref': 'W-30' }
        }
      ]
    }

    const result = await calculateHabitatSizes(pool, layers)

    expect(pool.query).toHaveBeenCalledWith(CALCULATE_HABITAT_SIZES_QUERY, [
      ['areas', 'areas', 'hedgerows', 'watercourses'],
      [0, 1, 0, 0],
      [
        JSON.stringify({ fid: 10, 'Parcel Ref': 'A-10' }),
        JSON.stringify({ fid: 11, 'Parcel Ref': 'A-11' }),
        JSON.stringify({ fid: 20, 'Parcel Ref': 'H-20' }),
        JSON.stringify({ fid: 30, 'Baseline Parcel Ref': 'W-30' })
      ],
      [
        JSON.stringify({ type: 'Polygon', coordinates: [] }),
        JSON.stringify({ type: 'Polygon', coordinates: [] }),
        JSON.stringify({ type: 'LineString', coordinates: [] }),
        JSON.stringify({ type: 'LineString', coordinates: [] })
      ],
      [27700, 27700, 4326, 4326]
    ])

    expect(result).toEqual({
      areaHabitats: {
        individualSquareMetres: [
          { idx: 0, fid: '10', featureRef: 'A-10', sizeSquareMetres: 1.25 },
          { idx: 1, fid: '11', featureRef: 'A-11', sizeSquareMetres: 0.75 }
        ],
        totalSquareMetres: 2
      },
      hedgerows: {
        individualMetres: [
          { idx: 0, fid: '20', featureRef: 'H-20', sizeMetres: 0.5 }
        ],
        totalMetres: 0.5
      },
      watercourses: {
        individualMetres: [
          { idx: 0, fid: '30', featureRef: 'W-30', sizeMetres: 0.25 }
        ],
        totalMetres: 0.25
      }
    })
  })
})
