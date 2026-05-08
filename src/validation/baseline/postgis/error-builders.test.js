import { describe, it, expect } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { ERROR_BUILDERS } from './error-builders.js'

describe('ERROR_BUILDERS — non-list errors', () => {
  it('NO_REDLINE returns code + message, no details', () => {
    const err = ERROR_BUILDERS[ERROR_CODES.NO_REDLINE]()
    expect(err).toEqual({
      code: ERROR_CODES.NO_REDLINE,
      message: 'Baseline file contains no redline boundary polygon'
    })
    expect(err.details).toBeUndefined()
  })

  it('REDLINE_AREA_TOO_LARGE includes the area in the message', () => {
    const err = ERROR_BUILDERS[ERROR_CODES.REDLINE_AREA_TOO_LARGE]({
      total: 121_000_000
    })
    expect(err.code).toBe(ERROR_CODES.REDLINE_AREA_TOO_LARGE)
    expect(err.message).toMatch(/121000000 sq m/)
    expect(err.details).toBeUndefined()
  })

  it('REDLINE_INVALID_GEOMETRY weaves reason and location into the message', () => {
    const err = ERROR_BUILDERS[ERROR_CODES.REDLINE_INVALID_GEOMETRY]({
      reason: 'Self-intersection',
      location_wkt: 'POINT(123 456)'
    })
    expect(err.message).toBe(
      'Redline boundary geometry is invalid: Self-intersection at POINT(123 456)'
    )
  })
})

describe('ERROR_BUILDERS — list errors carry details', () => {
  it('AREA_PARCELS_OUTSIDE_REDLINE renders Feature Ref labels and surfaces details', () => {
    const payload = {
      count: 2,
      sample: [
        { idx: 0, fid: '1', feature_ref: 'PR-42' },
        { idx: 1, fid: '2', feature_ref: 'PR-43' }
      ]
    }
    const err =
      ERROR_BUILDERS[ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE](payload)
    expect(err.code).toBe(ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE)
    expect(err.message).toBe(
      'One or more area habitat polygons are not entirely within the redline boundary: Feature Ref PR-42, Feature Ref PR-43'
    )
    expect(err.details).toEqual(payload)
  })

  it('falls back to fid when feature_ref is null', () => {
    const err = ERROR_BUILDERS[ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE]({
      count: 1,
      sample: [{ idx: 5, fid: '17', feature_ref: null }]
    })
    expect(err.message).toMatch(/fid 17$/)
  })

  it('falls back to feature #idx when both feature_ref and fid are missing', () => {
    const err = ERROR_BUILDERS[ERROR_CODES.TREES_OUTSIDE_REDLINE]({
      count: 1,
      sample: [{ idx: 3 }]
    })
    expect(err.message).toMatch(/feature #3$/)
  })

  it('appends "(and N more)" when count exceeds sample length', () => {
    const sample = Array.from({ length: 50 }, (_, i) => ({
      idx: i,
      fid: String(i + 1),
      feature_ref: `PR-${i + 1}`
    }))
    const err = ERROR_BUILDERS[ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE]({
      count: 73,
      sample
    })
    expect(err.message).toMatch(/\(and 23 more\)$/)
    expect(err.details.count).toBe(73)
    expect(err.details.sample).toHaveLength(50)
  })

  it("AREA_PARCELS_INVALID_GEOMETRY appends each row's reason in parentheses", () => {
    const err = ERROR_BUILDERS[ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY]({
      count: 1,
      sample: [
        {
          idx: 0,
          fid: '1',
          feature_ref: 'PR-42',
          reason: 'Self-intersection'
        }
      ]
    })
    expect(err.message).toBe(
      'One or more area habitat polygons have invalid geometry: Feature Ref PR-42 (Self-intersection)'
    )
  })

  it('PARCEL_OVERLAPS renders pairs with a ↔ separator', () => {
    const payload = {
      count: 1,
      sample: [
        {
          idx_a: 0,
          fid_a: '1',
          feature_ref_a: 'PR-42',
          idx_b: 1,
          fid_b: '2',
          feature_ref_b: 'PR-43'
        }
      ]
    }
    const err = ERROR_BUILDERS[ERROR_CODES.PARCEL_OVERLAPS](payload)
    expect(err.message).toBe(
      'One or more area habitat parcels overlap with other parcels: Feature Ref PR-42 ↔ Feature Ref PR-43'
    )
    expect(err.details).toEqual(payload)
  })

  it('SLIVERS_INSIDE_REDLINE renders area and location for each sliver', () => {
    const err = ERROR_BUILDERS[ERROR_CODES.SLIVERS_INSIDE_REDLINE]({
      count: 1,
      sample: [{ area_sqm: 0.32, location_wkt: 'POINT(530000 180000)' }]
    })
    expect(err.message).toContain('~0.32 sq m near POINT(530000 180000)')
  })

  it('SLIVERS_OUTSIDE_REDLINE uses the "habitat parcel parts outside" prefix', () => {
    const err = ERROR_BUILDERS[ERROR_CODES.SLIVERS_OUTSIDE_REDLINE]({
      count: 1,
      sample: [{ area_sqm: 1.5, location_wkt: 'POINT(530100 180100)' }]
    })
    expect(err.code).toBe(ERROR_CODES.SLIVERS_OUTSIDE_REDLINE)
    expect(err.message).toBe(
      'Baseline file contains habitat parcel parts outside the redline boundary: ~1.50 sq m near POINT(530100 180100)'
    )
    expect(err.details.count).toBe(1)
  })
})
