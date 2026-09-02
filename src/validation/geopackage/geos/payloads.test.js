import { describe, expect, it } from 'vitest'

import { ERROR_LIST_SAMPLE_CAP } from '../geometry-constants.js'
import {
  featureListPayload,
  invalidGeometryPayload,
  outsideRedlinePayload,
  overlapPayload,
  sliverPayload,
  tooSmallPayload
} from './payloads.js'

const feature = (idx, extra = {}) => ({
  idx,
  fid: String(idx + 1),
  featureRef: `H${idx}`,
  ...extra
})

describe('featureListPayload', () => {
  it('carries idx, fid and feature_ref under the SQL engine field names', () => {
    expect(featureListPayload([feature(3)])).toEqual({
      count: 1,
      sample: [{ idx: 3, fid: '4', feature_ref: 'H3' }]
    })
  })

  it('orders the sample by idx however the offenders arrived', () => {
    const payload = featureListPayload([feature(5), feature(1), feature(3)])
    expect(payload.sample.map((s) => s.idx)).toEqual([1, 3, 5])
  })

  it('caps the sample but keeps count truthful', () => {
    const offenders = Array.from({ length: 120 }, (_, i) => feature(i))
    const payload = featureListPayload(offenders)
    expect(payload.count).toBe(120)
    expect(payload.sample).toHaveLength(ERROR_LIST_SAMPLE_CAP)
    expect(payload.sample.at(-1).idx).toBe(ERROR_LIST_SAMPLE_CAP - 1)
  })

  it('does not reorder the caller’s array', () => {
    const offenders = [feature(5), feature(1)]
    featureListPayload(offenders)
    expect(offenders.map((f) => f.idx)).toEqual([5, 1])
  })
})

describe('invalidGeometryPayload', () => {
  it('adds the GEOS validity reason to each offender', () => {
    expect(
      invalidGeometryPayload([
        { feature: feature(0), reason: 'Self-intersection' }
      ])
    ).toEqual({
      count: 1,
      sample: [
        { idx: 0, fid: '1', feature_ref: 'H0', reason: 'Self-intersection' }
      ]
    })
  })
})

describe('overlapPayload', () => {
  it('carries both halves of the pair', () => {
    expect(overlapPayload([{ a: feature(0), b: feature(2) }])).toEqual({
      count: 1,
      sample: [
        {
          idx_a: 0,
          fid_a: '1',
          feature_ref_a: 'H0',
          idx_b: 2,
          fid_b: '3',
          feature_ref_b: 'H2'
        }
      ]
    })
  })

  it('orders by idx_a then idx_b', () => {
    const payload = overlapPayload([
      { a: feature(1), b: feature(5) },
      { a: feature(0), b: feature(9) },
      { a: feature(1), b: feature(2) }
    ])
    expect(payload.sample.map((s) => [s.idx_a, s.idx_b])).toEqual([
      [0, 9],
      [1, 2],
      [1, 5]
    ])
  })
})

describe('tooSmallPayload', () => {
  it('names the offending parcel’s own area', () => {
    expect(tooSmallPayload([{ feature: feature(0), areaSqM: 0.81 }])).toEqual({
      count: 1,
      sample: [{ idx: 0, fid: '1', feature_ref: 'H0', area_sqm: 0.81 }]
    })
  })
})

describe('outsideRedlinePayload', () => {
  it('names the escaping area and where it is', () => {
    expect(
      outsideRedlinePayload([
        { feature: feature(0), escapeAreaSqM: 800, escapeWkt: 'POLYGON((0 0))' }
      ])
    ).toEqual({
      count: 1,
      sample: [
        {
          idx: 0,
          fid: '1',
          feature_ref: 'H0',
          escape_area_sqm: 800,
          escape_location_wkt: 'POLYGON((0 0))'
        }
      ]
    })
  })
})

describe('sliverPayload', () => {
  it('reports pieces largest first, so the worst offender leads the message', () => {
    const payload = sliverPayload([
      { areaSqM: 5, wkt: 'a' },
      { areaSqM: 900, wkt: 'b' },
      { areaSqM: 50, wkt: 'c' }
    ])
    expect(payload.sample.map((s) => s.area_sqm)).toEqual([900, 50, 5])
    expect(payload.sample[0]).toEqual({ area_sqm: 900, location_wkt: 'b' })
  })
})
