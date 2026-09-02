import { describe, expect, it } from 'vitest'

import {
  DIVERGENCE_KIND,
  compareEngineResults,
  divergenceDetail
} from './shadow.js'

const error = (code, message, details = null) => ({ code, message, details })
const result = (valid, errors = []) => ({ valid, errors })

describe('compareEngineResults', () => {
  it('reports no divergence for identical results', () => {
    const a = result(false, [
      error('PARCEL_OVERLAPS', 'overlaps', { count: 1, sample: [{ idx: 0 }] })
    ])
    const b = result(false, [
      error('PARCEL_OVERLAPS', 'overlaps', { count: 1, sample: [{ idx: 0 }] })
    ])
    expect(compareEngineResults(a, b)).toMatchObject({ diverged: false })
  })

  it('ignores object key order, which PostgreSQL and JS disagree about', () => {
    const a = result(false, [
      error('AREA_PARCELS_TOO_SMALL', 'small', {
        count: 1,
        sample: [{ fid: '1', idx: 0, feature_ref: 'H1' }]
      })
    ])
    const b = result(false, [
      error('AREA_PARCELS_TOO_SMALL', 'small', {
        count: 1,
        sample: [{ idx: 0, feature_ref: 'H1', fid: '1' }]
      })
    ])
    expect(compareEngineResults(a, b).diverged).toBe(false)
  })

  it('ignores float noise below a micron', () => {
    const a = result(false, [
      error('AREA_PARCELS_TOO_SMALL', 'small', {
        count: 1,
        sample: [{ area_sqm: 0.81 }]
      })
    ])
    const b = result(false, [
      error('AREA_PARCELS_TOO_SMALL', 'small', {
        count: 1,
        sample: [{ area_sqm: 0.810000000001 }]
      })
    ])
    expect(compareEngineResults(a, b).diverged).toBe(false)
  })

  it('reports a codes divergence when one engine accepts and the other rejects', () => {
    const comparison = compareEngineResults(
      result(true),
      result(false, [error('PARCEL_OVERLAPS', 'overlaps')])
    )
    expect(comparison).toMatchObject({
      diverged: true,
      kind: DIVERGENCE_KIND.codes,
      postgisCodes: [],
      geosCodes: ['PARCEL_OVERLAPS']
    })
  })

  it('reports a codes divergence when the error lists differ', () => {
    const comparison = compareEngineResults(
      result(false, [error('PARCEL_OVERLAPS', 'a')]),
      result(false, [error('AREA_SUM_MISMATCH', 'b')])
    )
    expect(comparison.kind).toBe(DIVERGENCE_KIND.codes)
  })

  it('reports a payload divergence when the same code carries a different count', () => {
    const comparison = compareEngineResults(
      result(false, [error('PARCEL_OVERLAPS', 'overlaps: 2', { count: 2 })]),
      result(false, [error('PARCEL_OVERLAPS', 'overlaps: 3', { count: 3 })])
    )
    expect(comparison.kind).toBe(DIVERGENCE_KIND.payload)
  })

  it('reports only a wkt divergence when the shapes are rendered differently', () => {
    // The two libraries can start an identical ring at different vertices. The
    // verdict, the count and the measured area are unaffected.
    const comparison = compareEngineResults(
      result(false, [
        error('SLIVERS_OUTSIDE_REDLINE', 'near POLYGON((0 0,1 0,1 1,0 0))', {
          count: 1,
          sample: [
            { area_sqm: 800, location_wkt: 'POLYGON((0 0,1 0,1 1,0 0))' }
          ]
        })
      ]),
      result(false, [
        error('SLIVERS_OUTSIDE_REDLINE', 'near POLYGON((1 0,1 1,0 0,1 0))', {
          count: 1,
          sample: [
            { area_sqm: 800, location_wkt: 'POLYGON((1 0,1 1,0 0,1 0))' }
          ]
        })
      ])
    )
    expect(comparison.kind).toBe(DIVERGENCE_KIND.wkt)
  })

  it('treats a differing measurement alongside differing WKT as a payload divergence', () => {
    const comparison = compareEngineResults(
      result(false, [
        error('SLIVERS_OUTSIDE_REDLINE', 'a', {
          count: 1,
          sample: [{ area_sqm: 800, location_wkt: 'A' }]
        })
      ]),
      result(false, [
        error('SLIVERS_OUTSIDE_REDLINE', 'a', {
          count: 1,
          sample: [{ area_sqm: 900, location_wkt: 'B' }]
        })
      ])
    )
    expect(comparison.kind).toBe(DIVERGENCE_KIND.payload)
  })
})

describe('divergenceDetail', () => {
  it('summarises both sides without inlining thousands of sample rows', () => {
    const detail = divergenceDetail(
      result(false, [
        error('PARCEL_OVERLAPS', 'overlaps', {
          count: 5000,
          sample: Array.from({ length: 50 }, (_, i) => ({ idx: i }))
        })
      ]),
      result(true)
    )
    expect(detail).toEqual({
      postgisValid: false,
      geosValid: true,
      postgisErrors: [
        { code: 'PARCEL_OVERLAPS', count: 5000, message: 'overlaps' }
      ],
      geosErrors: []
    })
  })
})
