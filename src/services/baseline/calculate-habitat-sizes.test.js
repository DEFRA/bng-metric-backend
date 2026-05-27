import { describe, it, expect, vi } from 'vitest'

import {
  buildLayerArrays,
  calculateHabitatSizes,
  HABITAT_SIZE_LAYERS,
  CALCULATE_HABITAT_SIZES_QUERY
} from './calculate-habitat-sizes.js'

const BNG_SRID = 27700
const WGS84_SRID = 4326

const FEAT_ID_AREA_0 = 'area0000-0000-0000-0000-000000000000'
const FEAT_ID_AREA_1 = 'area1111-0000-0000-0000-000000000000'
const FEAT_ID_HEDGE_0 = 'hedg0000-0000-0000-0000-000000000000'
const FEAT_ID_WRCRS_0 = 'wrcs0000-0000-0000-0000-000000000000'

const MOCK_SIZE_QUERY_ROWS = [
  { layer: 'areas', feature_id: FEAT_ID_AREA_0, size_value: '1.25' },
  { layer: 'areas', feature_id: FEAT_ID_AREA_1, size_value: '0.75' },
  { layer: 'hedgerows', feature_id: FEAT_ID_HEDGE_0, size_value: '0.5' },
  { layer: 'watercourses', feature_id: FEAT_ID_WRCRS_0, size_value: '0.25' }
]

const LAYERS_FOR_SIZE_QUERY = {
  areas: [
    {
      nativeGeometry: { type: 'Polygon', coordinates: [] },
      nativeSrid: BNG_SRID,
      featureId: FEAT_ID_AREA_0
    },
    {
      nativeGeometry: { type: 'Polygon', coordinates: [] },
      nativeSrid: BNG_SRID,
      featureId: FEAT_ID_AREA_1
    }
  ],
  hedgerows: [
    {
      nativeGeometry: { type: 'LineString', coordinates: [] },
      nativeSrid: WGS84_SRID,
      featureId: FEAT_ID_HEDGE_0
    }
  ],
  watercourses: [
    {
      nativeGeometry: { type: 'LineString', coordinates: [] },
      nativeSrid: WGS84_SRID,
      featureId: FEAT_ID_WRCRS_0
    }
  ]
}

describe('HABITAT_SIZE_LAYERS', () => {
  it('includes only layers used by baseline size calculations', () => {
    expect(HABITAT_SIZE_LAYERS).toEqual(['areas', 'hedgerows', 'watercourses'])
  })
})

describe('buildLayerArrays', () => {
  it('builds parallel arrays for areas, hedgerows and watercourses', () => {
    const layers = {
      areas: [
        {
          nativeGeometry: { type: 'Polygon', coordinates: [] },
          nativeSrid: BNG_SRID,
          featureId: 'fid-area-1'
        }
      ],
      hedgerows: [
        {
          nativeGeometry: { type: 'LineString', coordinates: [] },
          nativeSrid: WGS84_SRID,
          featureId: 'fid-hedg-1'
        }
      ],
      watercourses: [
        {
          nativeGeometry: { type: 'LineString', coordinates: [] },
          nativeSrid: WGS84_SRID,
          featureId: 'fid-wrcs-1'
        }
      ]
    }

    const result = buildLayerArrays(layers)

    expect(result.layerNames).toEqual(['areas', 'hedgerows', 'watercourses'])
    expect(result.featureIds).toEqual([
      'fid-area-1',
      'fid-hedg-1',
      'fid-wrcs-1'
    ])
    expect(result.srids).toEqual([BNG_SRID, WGS84_SRID, WGS84_SRID])
  })

  it('skips features without geometry', () => {
    const result = buildLayerArrays({
      areas: [{ nativeSrid: BNG_SRID, featureId: 'fid-no-geom' }]
    })

    expect(result.layerNames).toEqual([])
    expect(result.featureIds).toEqual([])
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
      query: vi.fn().mockResolvedValue({ rows: MOCK_SIZE_QUERY_ROWS })
    }

    const result = await calculateHabitatSizes(pool, LAYERS_FOR_SIZE_QUERY)

    expect(pool.query).toHaveBeenCalledWith(CALCULATE_HABITAT_SIZES_QUERY, [
      ['areas', 'areas', 'hedgerows', 'watercourses'],
      [FEAT_ID_AREA_0, FEAT_ID_AREA_1, FEAT_ID_HEDGE_0, FEAT_ID_WRCRS_0],
      [
        JSON.stringify({ type: 'Polygon', coordinates: [] }),
        JSON.stringify({ type: 'Polygon', coordinates: [] }),
        JSON.stringify({ type: 'LineString', coordinates: [] }),
        JSON.stringify({ type: 'LineString', coordinates: [] })
      ],
      [BNG_SRID, BNG_SRID, WGS84_SRID, WGS84_SRID]
    ])

    expect(result).toEqual({
      areaHabitats: {
        individualSquareMetres: [
          { featureId: FEAT_ID_AREA_0, sizeSquareMetres: 1.25 },
          { featureId: FEAT_ID_AREA_1, sizeSquareMetres: 0.75 }
        ],
        totalSquareMetres: 2
      },
      hedgerows: {
        individualMetres: [{ featureId: FEAT_ID_HEDGE_0, sizeMetres: 0.5 }],
        totalMetres: 0.5
      },
      watercourses: {
        individualMetres: [{ featureId: FEAT_ID_WRCRS_0, sizeMetres: 0.25 }],
        totalMetres: 0.25
      }
    })
  })
})
