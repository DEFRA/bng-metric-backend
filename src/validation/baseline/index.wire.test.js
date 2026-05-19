import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from './errors.js'

vi.mock('./geopackage.js', () => ({
  readBaselineGeoPackage: vi.fn(() => ({
    redline: [],
    areas: [],
    missingLayers: []
  }))
}))
vi.mock('./postgis/index.js', () => ({
  validateBaselineLayersPostgis: vi.fn(async () => ({
    valid: true,
    errors: []
  }))
}))
vi.mock('./distinctiveness-check.js', () => ({
  checkBaselineDistinctiveness: vi.fn(() => null)
}))

const BASELINE_WIRE_MKDTEMP_PREFIX = 'bng-baseline-wire-test-'

describe('validateBaselineFile wired to Postgres', () => {
  let validateBaselineFile
  let readBaselineGeoPackage
  let validateBaselineLayersPostgis

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ validateBaselineFile } = await import('./index.js'))
    ;({ readBaselineGeoPackage } = await import('./geopackage.js'))
    ;({ validateBaselineLayersPostgis } = await import('./postgis/index.js'))
  })

  it('reads the GeoPackage then runs PostGIS validation', async () => {
    const pooled = {}

    vi.mocked(validateBaselineLayersPostgis).mockResolvedValueOnce({
      valid: false,
      errors: [{ code: 'X', message: 'y' }]
    })

    const tempPrefix = join(tmpdir(), BASELINE_WIRE_MKDTEMP_PREFIX)
    const isolateDir = await mkdtemp(tempPrefix)
    const filePath = join(isolateDir, 'test.gpkg')
    try {
      const out = await validateBaselineFile(filePath, pooled)

      expect(readBaselineGeoPackage).toHaveBeenCalledWith(filePath)
      expect(validateBaselineLayersPostgis).toHaveBeenCalledWith(pooled, {
        redline: [],
        areas: [],
        missingLayers: []
      })
      expect(out).toEqual({
        valid: false,
        errors: [{ code: 'X', message: 'y' }]
      })
    } finally {
      await rm(isolateDir, { recursive: true, force: true })
    }
  })
})

describe('validateBaselineLayers wired to Postgres', () => {
  let validateBaselineLayers
  let readBaselineGeoPackage
  let validateBaselineLayersPostgis
  let checkBaselineDistinctiveness

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ validateBaselineLayers } = await import('./index.js'))
    ;({ readBaselineGeoPackage } = await import('./geopackage.js'))
    ;({ validateBaselineLayersPostgis } = await import('./postgis/index.js'))
    ;({ checkBaselineDistinctiveness } =
      await import('./distinctiveness-check.js'))
  })

  it('forwards layers to validateBaselineLayersPostgis', async () => {
    const pooled = {}
    const layers = { redline: [1], areas: [] }
    vi.mocked(validateBaselineLayersPostgis).mockResolvedValueOnce({
      valid: true,
      errors: []
    })

    const out = await validateBaselineLayers(layers, pooled)

    expect(readBaselineGeoPackage).not.toHaveBeenCalled()
    expect(validateBaselineLayersPostgis).toHaveBeenCalledWith(pooled, layers)
    expect(out).toEqual({ valid: true, errors: [] })
  })

  it('prepends a distinctiveness error ahead of geometry errors', async () => {
    const pooled = {}
    const layers = { redline: [1], areas: [{}] }
    vi.mocked(validateBaselineLayersPostgis).mockResolvedValueOnce({
      valid: false,
      errors: [{ code: ERROR_CODES.PARCEL_OVERLAPS, message: 'overlap' }]
    })
    vi.mocked(checkBaselineDistinctiveness).mockReturnValueOnce({
      code: ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      message: 'out of scope',
      details: { count: 1, sample: [] }
    })

    const out = await validateBaselineLayers(layers, pooled)

    expect(out.valid).toBe(false)
    expect(out.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      ERROR_CODES.PARCEL_OVERLAPS
    ])
  })

  it('flips valid → false when only the distinctiveness check fails', async () => {
    const pooled = {}
    const layers = { redline: [1], areas: [{}] }
    vi.mocked(validateBaselineLayersPostgis).mockResolvedValueOnce({
      valid: true,
      errors: []
    })
    vi.mocked(checkBaselineDistinctiveness).mockReturnValueOnce({
      code: ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      message: 'out of scope',
      details: { count: 1, sample: [] }
    })

    const out = await validateBaselineLayers(layers, pooled)
    expect(out.valid).toBe(false)
    expect(out.errors).toHaveLength(1)
  })
})
