import { describe, it, expect, vi } from 'vitest'

import {
  attachGeometrySizes,
  buildLayerArrays,
  calculateHabitatSizes,
  habitatSizesFromGeometry,
  GEOMETRY_SIZE_FIELD,
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

  it('reuses the geometryJson cached at decode rather than re-serialising', () => {
    // BMD-914: readGeoPackage stringifies each geometry once; sizing reads it.
    const result = buildLayerArrays({
      areas: [
        {
          nativeGeometry: { type: 'Polygon', coordinates: [] },
          geometryJson: '{"cached":"area"}',
          nativeSrid: BNG_SRID,
          featureId: 'fid-area-1'
        }
      ]
    })

    expect(result.geoms).toEqual(['{"cached":"area"}'])
  })

  it('serialises the geometry when no cached string is present', () => {
    const geometry = { type: 'Polygon', coordinates: [] }
    const result = buildLayerArrays({
      areas: [{ nativeGeometry: geometry, nativeSrid: BNG_SRID }]
    })

    expect(result.geoms).toEqual([JSON.stringify(geometry)])
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

describe('sizes measured by the geometry engine', () => {
  const feature = (
    featureId,
    geometry = { type: 'Point', coordinates: [0, 0] }
  ) => ({
    featureId,
    nativeGeometry: geometry,
    nativeSrid: 27_700,
    properties: {}
  })

  it('stamps engine measurements onto features by their layer position', () => {
    const layers = {
      areas: [feature('a'), feature('b')],
      hedgerows: [feature('h')],
      watercourses: []
    }
    const stamped = attachGeometrySizes(layers, {
      areas: [
        { idx: 0, value: 10 },
        { idx: 1, value: 20 }
      ],
      hedgerows: [{ idx: 0, value: 30 }],
      watercourses: []
    })
    expect(stamped.areas.map((f) => f[GEOMETRY_SIZE_FIELD])).toEqual([10, 20])
    expect(stamped.hedgerows[0][GEOMETRY_SIZE_FIELD]).toBe(30)
  })

  it('leaves the caller’s layers untouched', () => {
    const layers = { areas: [feature('a')], hedgerows: [], watercourses: [] }
    attachGeometrySizes(layers, { areas: [{ idx: 0, value: 10 }] })
    expect(layers.areas[0][GEOMETRY_SIZE_FIELD]).toBeUndefined()
  })

  it('skips positions the engine did not measure, so gaps do not shift sizes', () => {
    const layers = {
      areas: [
        { featureId: 'skipped', nativeGeometry: null },
        feature('measured')
      ],
      hedgerows: [],
      watercourses: []
    }
    const stamped = attachGeometrySizes(layers, {
      areas: [{ idx: 1, value: 99 }]
    })
    expect(stamped.areas[0][GEOMETRY_SIZE_FIELD]).toBeUndefined()
    expect(stamped.areas[1][GEOMETRY_SIZE_FIELD]).toBe(99)
  })

  it('is a no-op when the engine measured nothing', () => {
    const layers = { areas: [feature('a')], hedgerows: [], watercourses: [] }
    expect(attachGeometrySizes(layers, undefined)).toBe(layers)
  })

  it('builds the sizing result without a database when every feature is measured', async () => {
    const layers = attachGeometrySizes(
      {
        areas: [feature('a1'), feature('a2')],
        hedgerows: [feature('h1')],
        watercourses: [feature('w1')]
      },
      {
        areas: [
          { idx: 0, value: 100 },
          { idx: 1, value: 250 }
        ],
        hedgerows: [{ idx: 0, value: 40 }],
        watercourses: [{ idx: 0, value: 60 }]
      }
    )
    // No pool at all: reaching PostGIS would throw.
    const sizes = await calculateHabitatSizes(null, layers)
    expect(sizes.areaHabitats).toEqual({
      individualSquareMetres: [
        { featureId: 'a1', sizeSquareMetres: 100 },
        { featureId: 'a2', sizeSquareMetres: 250 }
      ],
      totalSquareMetres: 350
    })
    expect(sizes.hedgerows.totalMetres).toBe(40)
    expect(sizes.watercourses.totalMetres).toBe(60)
  })

  it('falls back to the query when even one feature is unmeasured', () => {
    const layers = attachGeometrySizes(
      {
        areas: [feature('a1'), feature('a2')],
        hedgerows: [],
        watercourses: []
      },
      { areas: [{ idx: 0, value: 100 }] }
    )
    expect(habitatSizesFromGeometry(layers)).toBeNull()
  })

  it('falls back to the query when nothing was measured at all', () => {
    const layers = {
      areas: [feature('a1')],
      hedgerows: [],
      watercourses: []
    }
    expect(habitatSizesFromGeometry(layers)).toBeNull()
  })

  it('reports nothing to measure as nothing, so an empty file still hits the empty result', () => {
    expect(
      habitatSizesFromGeometry({ areas: [], hedgerows: [], watercourses: [] })
    ).toBeNull()
  })
})
